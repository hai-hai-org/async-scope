"""AppShell summary metrics.

전부 event buffer에서 파생한다. 별도 counter를 두면 buffer와 어긋난 순간 어느 쪽이
맞는지 판단할 근거가 없어진다.

시간은 전부 `perf_counter_ns` 기준이다. 벽시계(`server_time`)는 이 계층이 만들지 않는다.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from . import QueryError, parse_positive_int
from .requests import group_by_request
from .spans import blocked_gap

DEFAULT_WINDOW_S = 60
MAX_WINDOW_S = 3600

NS_PER_S = 1_000_000_000


def summarize(
    events: Iterable[dict[str, Any]],
    *,
    now_ns: int,
    window_s: int | str = DEFAULT_WINDOW_S,
) -> dict[str, Any]:
    """MetricCard 다섯 장이 읽는 값."""

    window_s = parse_positive_int(window_s, "window")
    if window_s > MAX_WINDOW_S:
        raise QueryError(f"window must be <= {MAX_WINDOW_S}")

    events = list(events)
    window_ns = window_s * NS_PER_S
    # buffer가 window를 다 덮지 못하면 rate가 실제보다 낮게 나온다. 실제로 덮은 구간으로
    # 나누고 그 값을 같이 돌려줘서 소비자가 잘린 걸 알 수 있게 한다.
    oldest_ns = min((_timestamp(event) for event in events), default=None)
    measured_window_ns = 0 if oldest_ns is None else min(window_ns, max(0, now_ns - oldest_ns))
    windowed = [event for event in events if _timestamp(event) >= now_ns - measured_window_ns]

    gaps = [gap for event in windowed if (gap := blocked_gap(event)) is not None]
    delays = [stop - start for start, stop in gaps]

    return {
        "window_ns": window_ns,
        "measured_window_ns": measured_window_ns,
        "request_rate_per_second": _rate(windowed, measured_window_ns),
        "active_requests": _active_requests(events),
        "loop_delay": {
            "average_ns": sum(delays) // len(delays) if delays else None,
            "max_ns": max(delays) if delays else None,
            "samples": len(delays),
            "threshold_ns": _threshold_ns(events),
        },
        "blocking_count": len(delays),
    }


def _rate(windowed: list[dict[str, Any]], measured_window_ns: int) -> float | None:
    """잴 구간이 없으면 0이 아니라 null이다. 요청이 없던 것과 못 재는 것은 다르다."""
    if measured_window_ns <= 0:
        return None
    started = sum(1 for event in windowed if event.get("type") == "request.start")
    return round(started / (measured_window_ns / NS_PER_S), 3)


def _active_requests(events: list[dict[str, Any]]) -> int:
    """window로 자르지 않는다. window 전에 시작해 아직 도는 request가 빠진다.

    ponytail: query_requests(status="running")["total"]로도 되지만 summary 전체를 만드는
    비용이 붙는다. 개수만 필요하므로 grouping만 재사용한다.
    """
    active = 0
    for request_events in group_by_request(events).values():
        types = {event.get("type") for event in request_events}
        if "request.start" in types and "request.end" not in types:
            active += 1
    return active


def _threshold_ns(events: list[dict[str, Any]]) -> int | None:
    """heartbeat가 쓴 값을 이벤트에서 읽는다. analysis는 config를 import하지 않는다."""
    for event in reversed(events):
        if event.get("type") == "loop.blocked" and event.get("threshold_ns") is not None:
            return event["threshold_ns"]
    return None


def _timestamp(event: dict[str, Any]) -> int:
    return event.get("timestamp_ns") or 0
