"""Requests 화면과 request detail이 소비하는 read-only query."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from . import (
    DEFAULT_PAGE,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    QueryError,
    filter_values,
    paginate,
)
from .spans import (
    blocked_intervals,
    build_span_tree,
    overlaps_blocking,
    time_distribution,
)

DEFAULT_SORT = "started_at_ns"
DEFAULT_ORDER = "desc"

VALID_SORTS = {"started_at_ns", "duration_ns", "status", "path"}
VALID_ORDERS = {"asc", "desc"}

NUMERIC_SORTS = {"started_at_ns", "duration_ns"}

# 이름을 바꾸면 web/routes.py와 기존 테스트가 깨진다. 같은 예외를 두 이름으로 노출한다.
RequestQueryError = QueryError

__all__ = [
    "DEFAULT_PAGE",
    "DEFAULT_PAGE_SIZE",
    "MAX_PAGE_SIZE",
    "RequestQueryError",
    "get_request_detail",
    "group_by_request",
    "query_requests",
]


def query_requests(
    events: Iterable[dict[str, Any]],
    *,
    search: str | None = None,
    status: str | Iterable[str] | None = None,
    method: str | Iterable[str] | None = None,
    path: str | Iterable[str] | None = None,
    sort: str = DEFAULT_SORT,
    order: str = DEFAULT_ORDER,
    page: int | str = DEFAULT_PAGE,
    page_size: int | str = DEFAULT_PAGE_SIZE,
) -> dict[str, Any]:
    """Event stream을 request summary list로 변환한다."""

    sort = sort or DEFAULT_SORT
    if sort not in VALID_SORTS:
        raise QueryError(f"unsupported sort: {sort}")

    order = (order or DEFAULT_ORDER).lower()
    if order not in VALID_ORDERS:
        raise QueryError(f"unsupported order: {order}")

    events = list(events)
    blocked = blocked_intervals(events)
    rows = [
        (summary, request_events)
        for request_events in group_by_request(events).values()
        if (summary := _summarize_request(request_events, blocked)) is not None
    ]
    rows = _filter_rows(
        rows,
        search=search,
        status=status,
        method=method,
        path=path,
    )
    rows = _sort_rows(rows, sort=sort, order=order)

    return paginate([summary for summary, _events in rows], page, page_size)


def get_request_detail(
    events: Iterable[dict[str, Any]],
    request_id: str,
) -> dict[str, Any] | None:
    """request_id deep link용 상세 데이터를 반환한다.

    Execution Flow와 TimeDistribution이 여기서 나온다. blocking 구간은 request에 귀속되지
    않는 `loop.blocked`에서 오므로 전체 stream이 필요하다.
    """

    events = list(events)
    request_events = group_by_request(events).get(request_id)
    if request_events is None:
        return None

    blocked = blocked_intervals(events)
    summary = _summarize_request(request_events, blocked)
    if summary is None:
        return None

    return {
        "request": summary,
        "time_distribution": time_distribution(request_events, blocked),
        "spans": build_span_tree(request_events),
        "events": [_copy_event(event) for event in request_events],
    }


def group_by_request(events: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """request_id가 없는 이벤트(loop.blocked 등)는 어느 request에도 속하지 않는다."""
    grouped: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        request_id = event.get("request_id")
        if request_id is None:
            continue
        grouped.setdefault(request_id, []).append(event)
    return grouped


def _summarize_request(
    events: list[dict[str, Any]],
    blocked: list[tuple[int, int]] = (),
) -> dict[str, Any] | None:
    start = _first_of_type(events, "request.start")
    if start is None:
        return None

    end = _last_of_type(events, "request.end")
    response_start = _first_of_type(events, "response.start")

    request_id = start["request_id"]
    status = end.get("status") if end is not None else "running"
    status_code = _status_code(end, response_start)
    libraries = sorted(
        {
            library
            for event in events
            if isinstance((library := event.get("library")), str)
        }
    )
    span_ids = {event["span_id"] for event in events if event.get("span_id") is not None}
    task_ids = {event["task_id"] for event in events if event.get("task_id") is not None}

    started_at_ns = start["timestamp_ns"]
    ended_at_ns = end["timestamp_ns"] if end is not None else None

    return {
        "request_id": request_id,
        "method": start.get("method"),
        "path": start.get("path"),
        "status": status,
        "status_code": status_code,
        "started_at_ns": started_at_ns,
        "ended_at_ns": ended_at_ns,
        "duration_ns": end.get("duration_ns") if end is not None else None,
        "response_started_at_ns": (
            response_start["timestamp_ns"] if response_start is not None else None
        ),
        "event_count": len(events),
        "span_count": len(span_ids),
        "task_count": len(task_ids),
        "libraries": libraries,
        # request 자신의 blocking 이벤트가 없어도 window가 loop 지연과 겹치면 늦은 것이다.
        "has_blocking": (
            any(_is_blocking(event) for event in events)
            or overlaps_blocking(started_at_ns, ended_at_ns, blocked)
        ),
        "has_unknown_await": any(_is_unknown_await(event) for event in events),
    }


def _filter_rows(
    rows: list[tuple[dict[str, Any], list[dict[str, Any]]]],
    *,
    search: str | None,
    status: str | Iterable[str] | None,
    method: str | Iterable[str] | None,
    path: str | Iterable[str] | None,
) -> list[tuple[dict[str, Any], list[dict[str, Any]]]]:
    statuses = filter_values(status)
    methods = filter_values(method, uppercase=True)
    paths = filter_values(path)

    filtered = []
    for summary, events in rows:
        if statuses is not None and summary["status"] not in statuses:
            continue
        if methods is not None and summary["method"] not in methods:
            continue
        if paths is not None and summary["path"] not in paths:
            continue
        if search and not _matches_search(summary, events, search):
            continue
        filtered.append((summary, events))
    return filtered


def _sort_rows(
    rows: list[tuple[dict[str, Any], list[dict[str, Any]]]],
    *,
    sort: str,
    order: str,
) -> list[tuple[dict[str, Any], list[dict[str, Any]]]]:
    present = [(summary, events) for summary, events in rows if summary[sort] is not None]
    missing = [(summary, events) for summary, events in rows if summary[sort] is None]
    reverse = order == "desc"

    present.sort(
        key=lambda row: _sortable_value(row[0][sort], sort),
        reverse=reverse,
    )
    return present + missing


def _matches_search(
    summary: dict[str, Any],
    events: list[dict[str, Any]],
    search: str,
) -> bool:
    needle = search.casefold()
    values = [
        summary["request_id"],
        summary["method"],
        summary["path"],
        summary["status"],
        summary["status_code"],
        *summary["libraries"],
    ]
    values.extend(event.get("label") for event in events)
    values.extend(event.get("library") for event in events)

    return any(
        needle in str(value).casefold()
        for value in values
        if value is not None
    )


def _first_of_type(events: list[dict[str, Any]], event_type: str) -> dict[str, Any] | None:
    return next((event for event in events if event.get("type") == event_type), None)


def _last_of_type(events: list[dict[str, Any]], event_type: str) -> dict[str, Any] | None:
    for event in reversed(events):
        if event.get("type") == event_type:
            return event
    return None


def _status_code(
    end: dict[str, Any] | None,
    response_start: dict[str, Any] | None,
) -> int | None:
    if end is not None:
        return end.get("status_code")
    if response_start is not None:
        return response_start.get("status_code")
    return None


def _is_blocking(event: dict[str, Any]) -> bool:
    return event.get("type") == "loop.blocked" or event.get("category") == "blocking"


def _is_unknown_await(event: dict[str, Any]) -> bool:
    return (
        event.get("type") == "coroutine.suspend"
        and event.get("library") is None
        and event.get("label") == "unknown await"
    )


def _sortable_value(value: Any, sort: str) -> Any:
    if sort in NUMERIC_SORTS:
        return int(value)
    return str(value)


def _copy_event(event: dict[str, Any]) -> dict[str, Any]:
    copied = dict(event)
    if isinstance(source := copied.get("source"), dict):
        copied["source"] = dict(source)
    return copied
