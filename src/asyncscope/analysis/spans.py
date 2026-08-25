"""Execution Flow tree와 time distribution.

두 함수 다 request 하나의 이벤트만으로는 부족하다. `loop.blocked`는 특정 request 소유가
아니라서 `request_id`가 `None`이고(`collector/loop.py`), request로 grouping하면 사라진다.
그래서 blocking 구간은 전체 stream에서 한 번 뽑아 window와 겹치는지로 판정한다.
"""

from __future__ import annotations

from collections.abc import Iterable
from itertools import pairwise
from typing import Any

# 겹치는 구간은 rank가 높은 쪽이 이긴다. 어느 구간에도 안 덮인 시간이 unattributed다.
#
# waiting이 running보다 높은 이유: `await child()`는 child부터 부모까지 프레임 전부가
# suspend되지만 그 전파에 수 마이크로초가 걸린다. running을 우선하면 그 틈이 실행 시간으로
# 잡힌다. 반대로 concurrent background task의 실제 CPU 작업이 같은 request의 await에 덮일
# 수는 있는데, 그 경우는 loop delay로 드러나 blocking이 다시 이긴다.
_RANK = {"running": 1, "waiting": 2, "response": 3, "blocking": 4}
_CATEGORIES = ("running", "waiting", "blocking", "response", "unattributed")

_SPAN_EVENTS = ("coroutine.start", "coroutine.suspend", "coroutine.resume", "coroutine.end")


def blocked_gap(event: dict[str, Any]) -> tuple[int, int] | None:
    """`loop.blocked` 하나가 가리키는 침묵 구간. 길이를 모르면 None."""
    if event.get("type") != "loop.blocked":
        return None
    end = event.get("timestamp_ns")
    delay = event.get("delay_ns") or event.get("duration_ns")
    if end is None or not delay:
        return None
    # collector는 gap_start_ns를 붙이지만 계약 fixture에는 없다. 없으면 되돌려 계산한다.
    start = event.get("gap_start_ns")
    if start is None or start >= end:
        return end - delay, end
    # 구간 길이는 delay_ns와 정확히 같아야 한다. gap_start_ns는 emit()이 timestamp_ns를
    # 찍기 직전에 읽은 값이라, timestamp_ns까지를 구간 끝으로 쓰면 emit 자신의 몇 µs가
    # loop 지연에 섞인다.
    return start, start + delay


def blocked_intervals(events: Iterable[dict[str, Any]]) -> list[tuple[int, int]]:
    """전체 stream에서 `loop.blocked`가 가리키는 침묵 구간을 뽑는다."""
    return [gap for event in events if (gap := blocked_gap(event)) is not None]


def overlaps_blocking(
    started_at_ns: int | None,
    ended_at_ns: int | None,
    intervals: Iterable[tuple[int, int]],
) -> bool:
    """request window가 loop 지연 구간과 겹치는가. summary의 has_blocking이 쓴다."""
    if started_at_ns is None:
        return False
    end = ended_at_ns if ended_at_ns is not None else started_at_ns
    return any(start < max(end, started_at_ns) and started_at_ns < stop for start, stop in intervals)


def build_span_tree(request_events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """span_id로 coroutine 이벤트를 묶어 부모·자식 tree를 만든다."""
    nodes: dict[str, dict[str, Any]] = {}
    for event in sorted(request_events, key=_timestamp):
        if event.get("type") not in _SPAN_EVENTS or event.get("span_id") is None:
            continue
        nodes.setdefault(event["span_id"], _new_node(event))
        _apply(nodes[event["span_id"]], event)

    for node in nodes.values():
        node["libraries"] = sorted(node["libraries"])

    roots = []
    for node in nodes.values():
        parent = nodes.get(node["parent_span_id"])
        # parent가 stream에 없을 수 있다 (ring buffer에서 밀렸거나 다른 request의 Task).
        if parent is None:
            roots.append(node)
        else:
            parent["children"].append(node)

    for node in nodes.values():
        node["children"].sort(key=lambda child: child["started_at_ns"])
    roots.sort(key=lambda node: node["started_at_ns"])
    return roots


def time_distribution(
    request_events: list[dict[str, Any]],
    blocked: Iterable[tuple[int, int]] = (),
) -> dict[str, Any]:
    """request window를 카테고리별로 칠하고 남은 시간을 unattributed로 남긴다.

    합을 duration_ns에 억지로 맞추지 않는다 (DESIGN.md TimeDistribution).
    """
    start_event = _first(request_events, "request.start")
    if start_event is None:
        return _empty_distribution()

    end_event = _last(request_events, "request.end")
    started_at_ns = start_event["timestamp_ns"]
    ended_at_ns = (
        end_event["timestamp_ns"]
        if end_event is not None
        else max((_timestamp(event) for event in request_events), default=started_at_ns)
    )

    intervals = _span_intervals(request_events, ended_at_ns)
    response_start = _first(request_events, "response.start")
    if response_start is not None:
        intervals.append((response_start["timestamp_ns"], ended_at_ns, "response"))
    intervals.extend((start, stop, "blocking") for start, stop in blocked)

    buckets = _paint((started_at_ns, ended_at_ns), intervals)
    return {
        "duration_ns": end_event.get("duration_ns") if end_event is not None else None,
        "measured_ns": ended_at_ns - started_at_ns,
        "complete": end_event is not None,
        "buckets": buckets,
    }


def _span_intervals(
    request_events: list[dict[str, Any]],
    window_end_ns: int,
) -> list[tuple[int, int, str]]:
    """span별 실행/대기 구간. 마지막 상태는 window 끝에서 닫는다."""
    open_state: dict[str, tuple[int, str]] = {}
    intervals: list[tuple[int, int, str]] = []

    for event in sorted(request_events, key=_timestamp):
        span_id = event.get("span_id")
        event_type = event.get("type")
        if span_id is None or event_type not in _SPAN_EVENTS:
            continue

        now = event["timestamp_ns"]
        previous = open_state.pop(span_id, None)
        if previous is not None:
            intervals.append((previous[0], now, previous[1]))

        if event_type in ("coroutine.start", "coroutine.resume"):
            open_state[span_id] = (now, "running")
        elif event_type == "coroutine.suspend":
            open_state[span_id] = (now, "waiting")

    for start, category in open_state.values():
        intervals.append((start, window_end_ns, category))
    return intervals


def _paint(
    window: tuple[int, int],
    intervals: list[tuple[int, int, str]],
) -> dict[str, int]:
    """구간을 rank 순으로 칠한다. 반환값의 합은 항상 window 길이와 같다.

    ponytail: 경계마다 전체 구간을 훑는 O(경계 x 구간)이다. request 하나의 이벤트 수가
    입력이라 실측에서 문제되지 않는다. buffer를 통째로 칠해야 하면 sweep line으로 올린다.
    """
    start, end = window
    buckets = dict.fromkeys(_CATEGORIES, 0)
    if end <= start:
        return buckets

    clipped = [
        (max(low, start), min(high, end), category)
        for low, high, category in intervals
        if min(high, end) > max(low, start)
    ]

    points = {start, end}
    for low, high, _category in clipped:
        points.update((low, high))
    ordered = sorted(points)

    for left, right in pairwise(ordered):
        winner = None
        for low, high, category in clipped:
            if low <= left and right <= high and (winner is None or _RANK[category] > _RANK[winner]):
                winner = category
        buckets[winner or "unattributed"] += right - left
    return buckets


def _new_node(event: dict[str, Any]) -> dict[str, Any]:
    return {
        "span_id": event["span_id"],
        "parent_span_id": event.get("parent_span_id"),
        "task_id": event.get("task_id"),
        "label": event.get("label"),
        "source": dict(event["source"]) if isinstance(event.get("source"), dict) else None,
        "started_at_ns": event["timestamp_ns"],
        "ended_at_ns": None,
        "duration_ns": None,
        "wait_ns": 0,
        "libraries": set(),
        "evidence": event.get("evidence"),
        "confidence": event.get("confidence"),
        # coroutine.start를 못 본 span. 예외로 끝났거나 ring buffer에서 앞부분이 밀렸다.
        "truncated": event.get("type") != "coroutine.start",
        "children": [],
    }


def _apply(node: dict[str, Any], event: dict[str, Any]) -> None:
    event_type = event["type"]
    if event_type == "coroutine.start":
        node["started_at_ns"] = event["timestamp_ns"]
        node["truncated"] = False
        node["label"] = event.get("label")
        if isinstance(event.get("source"), dict):
            node["source"] = dict(event["source"])
    elif event_type == "coroutine.suspend":
        node["_suspended_at_ns"] = event["timestamp_ns"]
        if isinstance(library := event.get("library"), str):
            node["libraries"].add(library)
    elif event_type == "coroutine.resume":
        suspended_at = node.pop("_suspended_at_ns", None)
        if suspended_at is not None:
            node["wait_ns"] += event["timestamp_ns"] - suspended_at
    elif event_type == "coroutine.end":
        node.pop("_suspended_at_ns", None)
        node["ended_at_ns"] = event["timestamp_ns"]
        node["duration_ns"] = event.get("duration_ns")


def _empty_distribution() -> dict[str, Any]:
    return {
        "duration_ns": None,
        "measured_ns": 0,
        "complete": False,
        "buckets": dict.fromkeys(_CATEGORIES, 0),
    }


def _timestamp(event: dict[str, Any]) -> int:
    return event.get("timestamp_ns") or 0


def _first(events: list[dict[str, Any]], event_type: str) -> dict[str, Any] | None:
    return next((event for event in events if event.get("type") == event_type), None)


def _last(events: list[dict[str, Any]], event_type: str) -> dict[str, Any] | None:
    for event in reversed(events):
        if event.get("type") == event_type:
            return event
    return None
