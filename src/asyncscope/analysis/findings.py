"""Analyzer finding.

finding은 이벤트로 emit하지 않는다. buffer가 이미 판정에 필요한 것을 다 갖고 있으므로
조회할 때 파생한다. 판정 로직이 hot path에 들어가지 않고, ring buffer에서 밀려나지 않고,
threshold를 바꾸면 과거 데이터에도 소급 적용된다.

여기서 나오는 원인 지목은 전부 후보다. collector는 heartbeat 타이밍만으로 범인을 지목하지
않고(`contracts/README.md` Accuracy boundary), 분석 단계는 confidence를 달아 후보만 제시한다.
"""

from __future__ import annotations

from collections.abc import Iterable
from pathlib import Path
from typing import Any

from . import QueryError, filter_values, paginate
from .recommendations import recommend
from .requests import group_by_request
from .spans import blocked_gap, blocked_intervals, time_distribution

VALID_TYPES = {"blocking", "unattributed"}
VALID_SEVERITIES = {"low", "medium", "high"}

# heartbeat threshold가 이벤트에 없을 때만 쓰는 값 (collector.loop.DEFAULT_THRESHOLD와 같다).
FALLBACK_THRESHOLD_NS = 50_000_000

# 설명되지 않은 시간이 이만큼 이상일 때만 finding으로 올린다. 짧은 request의 측정 오차가
# 매번 finding이 되면 Analyzer가 쓸모없어진다.
UNATTRIBUTED_MIN_NS = 10_000_000
UNATTRIBUTED_MIN_SHARE = 0.2

_SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2}


def query_findings(
    events: Iterable[dict[str, Any]],
    *,
    finding_type: str | Iterable[str] | None = None,
    severity: str | Iterable[str] | None = None,
    evidence: str | Iterable[str] | None = None,
    request_id: str | Iterable[str] | None = None,
    page: int | str = 1,
    page_size: int | str = 50,
    project_root: str | Path | None = None,
) -> dict[str, Any]:
    """severity/evidence/type filter와 affected request query."""

    types = filter_values(finding_type)
    severities = filter_values(severity)
    evidences = filter_values(evidence)
    request_ids = filter_values(request_id)

    if types is not None and not types <= VALID_TYPES:
        raise QueryError(f"unsupported type: {sorted(types - VALID_TYPES)}")
    if severities is not None and not severities <= VALID_SEVERITIES:
        raise QueryError(f"unsupported severity: {sorted(severities - VALID_SEVERITIES)}")

    rows = [
        finding
        for finding in build_findings(events, project_root=project_root)
        if _matches(finding, types, severities, evidences, request_ids)
    ]
    return paginate(rows, page, page_size)


def get_finding(
    events: Iterable[dict[str, Any]],
    finding_id: str,
    *,
    project_root: str | Path | None = None,
) -> dict[str, Any] | None:
    return next(
        (
            finding
            for finding in build_findings(events, project_root=project_root)
            if finding["finding_id"] == finding_id
        ),
        None,
    )


def build_findings(
    events: Iterable[dict[str, Any]],
    *,
    project_root: str | Path | None = None,
) -> list[dict[str, Any]]:
    """심각한 것부터, 같은 심각도면 최근 것부터.

    project_root가 있으면 suspect 함수의 소스를 읽어 known blocking call을 지목한다.
    없으면 측정 안내로 떨어진다.
    """
    events = list(events)
    grouped = group_by_request(events)
    findings = _blocking_findings(events, grouped)
    findings.extend(_unattributed_findings(events, grouped))
    for finding in findings:
        finding["recommendation"] = recommend(finding, project_root)
    findings.sort(
        key=lambda finding: (_SEVERITY_RANK[finding["severity"]], finding["detected_at_ns"]),
        reverse=True,
    )
    return findings


def _blocking_findings(
    events: list[dict[str, Any]],
    grouped: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """loop.blocked 하나가 finding 하나다."""
    ordered = sorted(events, key=lambda event: event.get("timestamp_ns") or 0)
    findings = []

    for event in ordered:
        gap = blocked_gap(event)
        if gap is None:
            continue
        gap_start, gap_end = gap
        delay_ns = gap_end - gap_start
        threshold_ns = event.get("threshold_ns") or FALLBACK_THRESHOLD_NS
        findings.append(
            {
                # timestamp_ns는 perf_counter_ns라 loop.blocked 사이에서 유일하다.
                # sequence는 buffer가 붙이는 값이라 fixture에는 없다.
                "finding_id": f"blocking-{event['timestamp_ns']}",
                "type": "blocking",
                "severity": _blocking_severity(delay_ns, threshold_ns),
                "title": f"event loop가 {delay_ns / 1e6:.0f}ms 동안 응답하지 않았다",
                "evidence": event.get("evidence", "inferred"),
                "confidence": event.get("confidence"),
                "detected_at_ns": event["timestamp_ns"],
                "duration_ns": delay_ns,
                "threshold_ns": threshold_ns,
                "suspect": _suspect(ordered, gap_start),
                "affected_requests": _requests_overlapping(grouped, gap_start, gap_end),
                # build_findings가 채운다. 여기서는 키 순서만 잡는다.
                "recommendation": None,
            }
        )
    return findings


def _unattributed_findings(
    events: list[dict[str, Any]],
    grouped: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """duration의 상당 부분을 어떤 구간으로도 설명하지 못한 request."""
    blocked = blocked_intervals(events)
    findings = []

    for request_id, request_events in grouped.items():
        distribution = time_distribution(request_events, blocked)
        measured_ns = distribution["measured_ns"]
        unattributed_ns = distribution["buckets"]["unattributed"]
        if not distribution["complete"] or measured_ns <= 0:
            continue
        share = unattributed_ns / measured_ns
        if unattributed_ns < UNATTRIBUTED_MIN_NS or share < UNATTRIBUTED_MIN_SHARE:
            continue

        start = next(event for event in request_events if event.get("type") == "request.start")
        findings.append(
            {
                "finding_id": f"unattributed-{request_id}",
                "type": "unattributed",
                "severity": _share_severity(share),
                "title": (
                    f"{start.get('method')} {start.get('path')}의 "
                    f"{unattributed_ns / 1e6:.0f}ms를 어떤 구간으로도 설명하지 못했다"
                ),
                "evidence": "inferred",
                "confidence": None,
                "detected_at_ns": start["timestamp_ns"],
                "duration_ns": unattributed_ns,
                "threshold_ns": None,
                "suspect": None,
                "affected_requests": [_request_ref(request_events)],
                "recommendation": None,
            }
        )
    return findings


def _suspect(ordered: list[dict[str, Any]], gap_start_ns: int) -> dict[str, Any] | None:
    """침묵 구간 직전에 마지막으로 실행된 프로젝트 프레임. 확정이 아니라 후보다."""
    candidate = None
    for event in ordered:
        if (event.get("timestamp_ns") or 0) > gap_start_ns:
            break
        if event.get("type", "").startswith("coroutine.") and isinstance(
            event.get("source"), dict
        ):
            candidate = event
    if candidate is None:
        return None
    return {
        "source": dict(candidate["source"]),
        "label": candidate.get("label"),
        "span_id": candidate.get("span_id"),
        "request_id": candidate.get("request_id"),
        # heartbeat는 sampling이다. 이 프레임이 원인이라고 단정하지 않는다.
        "certainty": "candidate",
    }


def _requests_overlapping(
    grouped: dict[str, list[dict[str, Any]]],
    start_ns: int,
    end_ns: int,
) -> list[dict[str, Any]]:
    """loop 지연은 그 시간에 살아 있던 request 전부를 늦춘다."""
    affected = []
    for request_events in grouped.values():
        ref = _request_ref(request_events)
        if ref is None:
            continue
        window_end = ref["ended_at_ns"] if ref["ended_at_ns"] is not None else ref["started_at_ns"]
        if ref["started_at_ns"] < end_ns and start_ns < max(window_end, ref["started_at_ns"]):
            affected.append(ref)
    affected.sort(key=lambda ref: ref["started_at_ns"])
    return affected


def _request_ref(request_events: list[dict[str, Any]]) -> dict[str, Any] | None:
    start = next(
        (event for event in request_events if event.get("type") == "request.start"), None
    )
    if start is None:
        return None
    end = next(
        (event for event in reversed(request_events) if event.get("type") == "request.end"), None
    )
    return {
        "request_id": start["request_id"],
        "method": start.get("method"),
        "path": start.get("path"),
        "started_at_ns": start["timestamp_ns"],
        "ended_at_ns": end["timestamp_ns"] if end is not None else None,
    }


def _blocking_severity(delay_ns: int, threshold_ns: int) -> str:
    ratio = delay_ns / threshold_ns
    if ratio >= 10:
        return "high"
    if ratio >= 3:
        return "medium"
    return "low"


def _share_severity(share: float) -> str:
    if share >= 0.5:
        return "high"
    if share >= 0.3:
        return "medium"
    return "low"


def _matches(
    finding: dict[str, Any],
    types: set[str] | None,
    severities: set[str] | None,
    evidences: set[str] | None,
    request_ids: set[str] | None,
) -> bool:
    if types is not None and finding["type"] not in types:
        return False
    if severities is not None and finding["severity"] not in severities:
        return False
    if evidences is not None and finding["evidence"] not in evidences:
        return False
    if request_ids is None:
        return True
    return bool(request_ids & {ref["request_id"] for ref in finding["affected_requests"]})
