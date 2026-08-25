import json

import pytest

from asyncscope.analysis import QueryError
from asyncscope.storage import EventBuffer
from asyncscope.web.sse import (
    EVENT_NAME,
    GAP_EVENT_NAME,
    encode_event,
    encode_gap,
    parse_cursor,
)


def _event(name):
    return {"type": name, "timestamp_ns": 1}


def _frame(frame: bytes) -> dict:
    parsed = {}
    for line in frame.decode("utf-8").strip().splitlines():
        key, value = line.split(": ", 1)
        parsed[key] = value
    if "data" in parsed:
        parsed["data"] = json.loads(parsed["data"])
    return parsed


def test_encode_event_uses_sequence_as_sse_id():
    buffer = EventBuffer(max_events=2)
    buffer.append(_event("request.start"))
    event = buffer.snapshot()[0]

    frame = _frame(encode_event(event))

    assert frame["id"] == "1"
    assert frame["event"] == EVENT_NAME
    assert frame["data"]["type"] == "request.start"
    assert frame["data"]["sequence"] == 1


def test_encode_gap_reports_buffer_sequence_window():
    buffer = EventBuffer(max_events=1)
    buffer.append(_event("one"))
    buffer.append(_event("two"))

    frame = _frame(encode_gap(0, buffer))

    assert frame["event"] == GAP_EVENT_NAME
    assert frame["data"] == {
        "error": "event_gap",
        "cursor": 0,
        "first_sequence": 2,
        "last_sequence": 2,
        "dropped_count": 1,
    }


def test_parse_cursor_prefers_query_param_over_last_event_id():
    scope = {"headers": [(b"last-event-id", b"7")]}

    assert parse_cursor({"cursor": ["3"]}, scope) == 3
    assert parse_cursor({}, scope) == 7
    assert parse_cursor({}, {"headers": []}) is None


@pytest.mark.parametrize("params", [{"cursor": ["nope"]}, {"cursor": ["-1"]}])
def test_parse_cursor_rejects_invalid_values(params):
    with pytest.raises(QueryError):
        parse_cursor(params, {"headers": []})
