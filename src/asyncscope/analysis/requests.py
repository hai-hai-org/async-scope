"""Requests 화면과 request detail이 소비하는 read-only query."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 50
MAX_PAGE_SIZE = 200
DEFAULT_SORT = "started_at_ns"
DEFAULT_ORDER = "desc"

VALID_SORTS = {"started_at_ns", "duration_ns", "status", "path"}
VALID_ORDERS = {"asc", "desc"}

NUMERIC_SORTS = {"started_at_ns", "duration_ns"}


class RequestQueryError(ValueError):
    """사용자가 고칠 수 있는 query parameter 오류."""


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

    page = _parse_positive_int(page, "page")
    page_size = _parse_positive_int(page_size, "page_size")
    if page_size > MAX_PAGE_SIZE:
        raise RequestQueryError(f"page_size must be <= {MAX_PAGE_SIZE}")

    sort = sort or DEFAULT_SORT
    if sort not in VALID_SORTS:
        raise RequestQueryError(f"unsupported sort: {sort}")

    order = (order or DEFAULT_ORDER).lower()
    if order not in VALID_ORDERS:
        raise RequestQueryError(f"unsupported order: {order}")

    rows = [
        (summary, request_events)
        for request_events in _group_request_events(events).values()
        if (summary := _summarize_request(request_events)) is not None
    ]
    rows = _filter_rows(
        rows,
        search=search,
        status=status,
        method=method,
        path=path,
    )
    rows = _sort_rows(rows, sort=sort, order=order)

    total = len(rows)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        "items": [summary for summary, _events in rows[start:end]],
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_next": end < total,
    }


def get_request_detail(
    events: Iterable[dict[str, Any]],
    request_id: str,
) -> dict[str, Any] | None:
    """request_id deep link용 상세 데이터를 반환한다."""

    request_events = _group_request_events(events).get(request_id)
    if request_events is None:
        return None

    summary = _summarize_request(request_events)
    if summary is None:
        return None

    return {
        "request": summary,
        "events": [_copy_event(event) for event in request_events],
    }


def _group_request_events(events: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        request_id = event.get("request_id")
        if request_id is None:
            continue
        grouped.setdefault(request_id, []).append(event)
    return grouped


def _summarize_request(events: list[dict[str, Any]]) -> dict[str, Any] | None:
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

    return {
        "request_id": request_id,
        "method": start.get("method"),
        "path": start.get("path"),
        "status": status,
        "status_code": status_code,
        "started_at_ns": start["timestamp_ns"],
        "ended_at_ns": end["timestamp_ns"] if end is not None else None,
        "duration_ns": end.get("duration_ns") if end is not None else None,
        "response_started_at_ns": (
            response_start["timestamp_ns"] if response_start is not None else None
        ),
        "event_count": len(events),
        "span_count": len(span_ids),
        "task_count": len(task_ids),
        "libraries": libraries,
        "has_blocking": any(_is_blocking(event) for event in events),
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
    statuses = _filter_values(status)
    methods = _filter_values(method, uppercase=True)
    paths = _filter_values(path)

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


def _filter_values(
    value: str | Iterable[str] | None,
    *,
    uppercase: bool = False,
) -> set[str] | None:
    if value is None:
        return None
    values = [value] if isinstance(value, str) else list(value)
    normalized = {
        item.strip().upper() if uppercase else item.strip()
        for raw in values
        for item in str(raw).split(",")
        if item.strip()
    }
    return normalized or None


def _parse_positive_int(value: int | str, name: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise RequestQueryError(f"{name} must be an integer") from exc
    if parsed < 1:
        raise RequestQueryError(f"{name} must be >= 1")
    return parsed


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
