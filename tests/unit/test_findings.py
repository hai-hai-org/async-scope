"""Analyzer finding 파생.

finding은 이벤트가 아니라 query 시점 파생이라 별도 fixture 파일을 두지 않는다. 소비자
계약은 여기 적힌 기대 payload 자체다 — 파일로 복제하면 코드와 어긋나기만 한다.
"""

import json
from pathlib import Path

import pytest

from asyncscope.analysis import QueryError
from asyncscope.analysis.findings import build_findings, get_finding, query_findings
from asyncscope.analysis.recommendations import MEASURE_STEPS

FIXTURE_DIR = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"


def _events(*names):
    events = []
    for name in names:
        events.extend(json.loads((FIXTURE_DIR / f"{name}.json").read_text())["events"])
    return events


def test_loop_delay_becomes_one_finding_with_a_candidate_not_a_culprit():
    findings = build_findings(_events("blocking"))

    assert len(findings) == 1
    finding = findings[0]
    assert finding == {
        "finding_id": "blocking-2311000000",
        "type": "blocking",
        "severity": "medium",
        "title": "event loop가 300ms 동안 응답하지 않았다",
        "evidence": "inferred",
        "confidence": 0.6,
        "detected_at_ns": 2311000000,
        "duration_ns": 300000000,
        "threshold_ns": 50000000,
        "suspect": {
            "source": {"file": "examples/demo.py", "function": "blocking", "line": 49},
            "label": "blocking()",
            "span_id": "span-blocking-handler",
            "request_id": "req-blocking",
            "certainty": "candidate",
        },
        "affected_requests": [
            {
                "request_id": "req-blocking",
                "method": "GET",
                "path": "/demo/blocking",
                "started_at_ns": 2000000000,
                "ended_at_ns": 2313000000,
            }
        ],
        # project_root가 없으면 소스를 못 읽는다. 해결책을 단정하지 않고 측정 안내로 떨어진다.
        "recommendation": {
            "kind": "measure",
            "certainty": "unknown",
            "steps": [
                {"text": text, "source": None}
                for text in MEASURE_STEPS["blocking"]
            ],
        },
    }


def test_affected_requests_excludes_requests_that_started_after_the_gap():
    """지연이 끝난 뒤에 들어온 req-quick은 그 지연의 피해자가 아니다."""
    finding = build_findings(_events("blocking"))[0]

    assert [ref["request_id"] for ref in finding["affected_requests"]] == ["req-blocking"]


@pytest.mark.parametrize(
    ("delay_ns", "severity"),
    [(60_000_000, "low"), (200_000_000, "medium"), (900_000_000, "high")],
)
def test_blocking_severity_scales_with_the_threshold(delay_ns, severity):
    events = [
        {
            "type": "loop.blocked",
            "timestamp_ns": 1_000_000_000 + delay_ns,
            "request_id": None,
            "duration_ns": delay_ns,
            "delay_ns": delay_ns,
            "threshold_ns": 50_000_000,
            "evidence": "inferred",
            "confidence": 0.6,
        }
    ]

    assert build_findings(events)[0]["severity"] == severity


def test_unexplained_duration_becomes_an_inferred_finding():
    """수집이 설명하지 못한 시간을 침묵으로 넘기지 않는다."""
    events = [
        {
            "type": "request.start",
            "timestamp_ns": 0,
            "request_id": "req-dark",
            "method": "GET",
            "path": "/dark",
        },
        {
            "type": "request.end",
            "timestamp_ns": 120_000_000,
            "request_id": "req-dark",
            "duration_ns": 120_000_000,
            "status": "completed",
            "status_code": 200,
        },
    ]

    finding = build_findings(events)[0]
    assert finding["finding_id"] == "unattributed-req-dark"
    assert finding["type"] == "unattributed"
    assert finding["severity"] == "high"
    assert finding["evidence"] == "inferred"
    assert finding["duration_ns"] == 120_000_000
    assert finding["suspect"] is None
    assert [ref["request_id"] for ref in finding["affected_requests"]] == ["req-dark"]


def test_short_requests_do_not_flood_the_analyzer():
    """짧은 request의 측정 오차가 매번 finding이 되면 목록이 쓸모없어진다."""
    events = [
        {
            "type": "request.start",
            "timestamp_ns": 0,
            "request_id": "req-tiny",
            "method": "GET",
            "path": "/tiny",
        },
        {
            "type": "request.end",
            "timestamp_ns": 2_000_000,
            "request_id": "req-tiny",
            "duration_ns": 2_000_000,
            "status": "completed",
            "status_code": 200,
        },
    ]

    assert build_findings(events) == []


def test_query_findings_filters_by_type_severity_evidence_and_request():
    events = _events("blocking") + [
        {
            "type": "request.start",
            "timestamp_ns": 5_000_000_000,
            "request_id": "req-dark",
            "method": "GET",
            "path": "/dark",
        },
        {
            "type": "request.end",
            "timestamp_ns": 5_120_000_000,
            "request_id": "req-dark",
            "duration_ns": 120_000_000,
            "status": "completed",
            "status_code": 200,
        },
    ]

    everything = query_findings(events)
    assert everything["total"] == 2
    # 심각한 것이 먼저 온다.
    assert [item["severity"] for item in everything["items"]] == ["high", "medium"]

    assert query_findings(events, finding_type="blocking")["total"] == 1
    assert query_findings(events, severity="high")["total"] == 1
    assert query_findings(events, evidence="inferred")["total"] == 2
    assert query_findings(events, severity="low,medium")["total"] == 1

    affected = query_findings(events, request_id="req-blocking")
    assert [item["finding_id"] for item in affected["items"]] == ["blocking-2311000000"]
    assert query_findings(events, request_id="req-quick")["total"] == 0

    paged = query_findings(events, page=2, page_size=1)
    assert paged["has_next"] is False
    assert [item["severity"] for item in paged["items"]] == ["medium"]


def test_get_finding_deep_link_and_missing_id():
    events = _events("blocking")

    assert get_finding(events, "blocking-2311000000")["type"] == "blocking"
    assert get_finding(events, "blocking-1") is None


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"finding_type": "guess"}, "unsupported type"),
        ({"severity": "catastrophic"}, "unsupported severity"),
        ({"page": 0}, "page must be >= 1"),
        ({"page_size": 201}, "page_size must be <="),
    ],
)
def test_query_findings_rejects_invalid_parameters(kwargs, message):
    with pytest.raises(QueryError, match=message):
        query_findings(_events("blocking"), **kwargs)


def test_recommendation_names_the_known_blocking_call_when_source_is_readable(tmp_path):
    """KNOWN_BLOCKING에 정확히 일치하는 호출만 지목한다."""
    (tmp_path / "service.py").write_text(
        "import time\n"
        "\n"
        "def decorate(fn):\n"
        "    return fn\n"
        "\n"
        "@decorate\n"
        "async def handler():\n"
        "    time.sleep(0.3)\n"
        "    return 1\n"
    )
    events = [
        {
            "type": "coroutine.start",
            "timestamp_ns": 900_000_000,
            "request_id": "req-1",
            "span_id": "span-1",
            "source": {"file": "service.py", "function": "handler", "line": 6},
            "category": "running",
            "label": "handler()",
        },
        {
            "type": "loop.blocked",
            "timestamp_ns": 1_300_000_000,
            "request_id": None,
            "duration_ns": 300_000_000,
            "delay_ns": 300_000_000,
            "threshold_ns": 50_000_000,
            "evidence": "inferred",
            "confidence": 0.6,
        },
    ]

    without_root = build_findings(events)[0]["recommendation"]
    assert without_root["kind"] == "measure"

    recommendation = build_findings(events, project_root=tmp_path)[0]["recommendation"]
    assert recommendation["kind"] == "known_blocking_call"
    # 정적 분석은 그 호출이 실제로 실행됐다는 증거가 아니다.
    assert recommendation["certainty"] == "candidate"
    assert len(recommendation["steps"]) == 1
    step = recommendation["steps"][0]
    assert "time.sleep()" in step["text"]
    assert "await asyncio.sleep()" in step["text"]
    # decorator가 붙어 co_firstlineno가 6이어도 실제 호출 줄을 가리킨다.
    assert step["source"] == {"file": "service.py", "line": 8}


def test_a_request_that_waits_on_one_await_becomes_an_observed_finding():
    """loop.blocked가 없어도 느린 request가 있다. 상대가 늦으면 loop은 멀쩡하다."""
    findings = [
        finding
        for finding in build_findings(_events("ui-stress"))
        if finding["type"] == "long_wait"
    ]

    assert len(findings) == 1
    finding = findings[0]
    assert finding["finding_id"] == "long-wait-req-long"
    assert finding["severity"] == "high"
    # blocking과 다르다. suspend/resume을 실제로 봤으므로 후보가 아니라 관측이다.
    assert finding["evidence"] == "observed"
    assert finding["confidence"] is None
    assert finding["suspect"]["certainty"] == "observed"
    assert finding["suspect"]["source"] is not None
    assert [ref["request_id"] for ref in finding["affected_requests"]] == ["req-long"]


def test_a_short_await_is_not_a_long_wait():
    """50ms sleep은 문제가 아니다. 하한을 안 걸면 모든 request가 finding이 된다."""
    assert build_findings(_events("timeline")) == []


def test_long_wait_needs_both_a_floor_and_a_share():
    """구간의 절반 미만이면 그 대기가 request를 설명하지 못한다."""
    long_enough = 2_000_000_000
    events = [
        {
            "type": "request.start",
            "timestamp_ns": 0,
            "request_id": "req-mixed",
            "method": "GET",
            "path": "/mixed",
        },
        {
            "type": "coroutine.start",
            "timestamp_ns": 1,
            "request_id": "req-mixed",
            "span_id": "span-1",
            "source": {"file": "a.py", "function": "handler", "line": 1},
            "category": "running",
            "label": "handler()",
        },
        {
            "type": "coroutine.suspend",
            "timestamp_ns": 2,
            "request_id": "req-mixed",
            "span_id": "span-1",
            "category": "await",
            "label": "unknown await",
        },
        {
            "type": "coroutine.resume",
            "timestamp_ns": 2 + long_enough,
            "request_id": "req-mixed",
            "span_id": "span-1",
            "category": "running",
            "label": "handler() resumed",
        },
        {
            # 대기 뒤에 그보다 훨씬 긴 실행이 이어져 비중이 절반 밑으로 떨어진다.
            "type": "request.end",
            "timestamp_ns": 2 + long_enough * 5,
            "request_id": "req-mixed",
            "duration_ns": long_enough * 5,
            "status": "completed",
            "status_code": 200,
        },
    ]

    assert not [f for f in build_findings(events) if f["type"] == "long_wait"]


def test_long_wait_is_filterable_by_type():
    events = _events("ui-stress")

    assert query_findings(events, finding_type="long_wait")["total"] == 1
    assert query_findings(events, finding_type="blocking,long_wait")["total"] == 2
    assert query_findings(events, request_id="req-long")["total"] == 1
