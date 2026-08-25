"""Server-Sent Events transport for AsyncScope events."""

from __future__ import annotations

import asyncio
import json
from typing import Any

from ..analysis import QueryError

EVENT_NAME = "asyncscope.event"
GAP_EVENT_NAME = "asyncscope.gap"
DEFAULT_POLL_INTERVAL = 0.05


async def handle_sse(
    buffer,
    params: dict[str, list[str]],
    scope,
    receive,
    send,
    *,
    poll_interval: float = DEFAULT_POLL_INTERVAL,
) -> None:
    """Replay current events, then stream new ones until the client disconnects."""

    cursor = parse_cursor(params, scope)
    once = _truthy(_one(params, "once"))

    await _start_sse(send)

    if buffer.cursor_was_dropped(cursor):
        await send(
            {
                "type": "http.response.body",
                "body": encode_gap(cursor, buffer),
                "more_body": False,
            }
        )
        return

    last_cursor = cursor
    last_cursor = await _send_events(send, buffer.since(cursor), last_cursor)
    if once:
        await send({"type": "http.response.body", "body": b"", "more_body": False})
        return

    while True:
        if await _client_disconnected(receive, poll_interval):
            await send({"type": "http.response.body", "body": b"", "more_body": False})
            return

        if buffer.cursor_was_dropped(last_cursor):
            await send(
                {
                    "type": "http.response.body",
                    "body": encode_gap(last_cursor, buffer),
                    "more_body": False,
                }
            )
            return

        last_cursor = await _send_events(send, buffer.since(last_cursor), last_cursor)


def parse_cursor(params: dict[str, list[str]], scope) -> int | None:
    """query `cursor`가 `Last-Event-ID` header보다 우선한다."""

    raw = _one(params, "cursor")
    if raw is None:
        raw = _last_event_id(scope)
    if raw is None:
        return None
    try:
        cursor = int(raw)
    except (TypeError, ValueError) as exc:
        raise QueryError("cursor must be an integer") from exc
    if cursor < 0:
        raise QueryError("cursor must be >= 0")
    return cursor


def encode_event(event: dict[str, Any]) -> bytes:
    """normalized event 하나를 SSE frame으로 직렬화한다."""

    sequence = event.get("sequence")
    if sequence is None:
        raise ValueError("SSE events require storage-owned sequence")
    return _frame(EVENT_NAME, event, event_id=sequence)


def encode_gap(cursor: int | None, buffer) -> bytes:
    """client cursor 이후 필요한 event가 이미 밀려난 상태를 알린다."""

    return _frame(
        GAP_EVENT_NAME,
        {
            "error": "event_gap",
            "cursor": cursor,
            "first_sequence": buffer.first_sequence,
            "last_sequence": buffer.last_sequence,
            "dropped_count": buffer.dropped_count,
        },
    )


async def _send_events(send, events: list[dict], last_cursor: int | None) -> int | None:
    for event in events:
        await send(
            {
                "type": "http.response.body",
                "body": encode_event(event),
                "more_body": True,
            }
        )
        last_cursor = event["sequence"]
    return last_cursor


async def _start_sse(send) -> None:
    await send(
        {
            "type": "http.response.start",
            "status": 200,
            "headers": [
                (b"content-type", b"text/event-stream; charset=utf-8"),
                (b"cache-control", b"no-cache"),
            ],
        }
    )


async def _client_disconnected(receive, timeout: float) -> bool:
    try:
        message = await asyncio.wait_for(receive(), timeout=timeout)
    except TimeoutError:
        return False
    return message.get("type") == "http.disconnect"


def _frame(event_name: str, payload: dict[str, Any], *, event_id: int | None = None) -> bytes:
    lines = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event_name}")
    data = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    lines.append(f"data: {data}")
    return ("\n".join(lines) + "\n\n").encode("utf-8")


def _last_event_id(scope) -> str | None:
    for name, value in scope.get("headers", []):
        if name.lower() == b"last-event-id":
            return value.decode("utf-8")
    return None


def _one(params: dict[str, list[str]], name: str) -> str | None:
    values = params.get(name)
    if not values:
        return None
    return values[-1]


def _truthy(value: str | None) -> bool:
    return value is not None and value.lower() in {"1", "true", "yes", "on"}
