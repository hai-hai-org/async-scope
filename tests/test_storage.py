import json

import pytest

from asyncscope.storage import EventBuffer, EventBufferSink


def _event(name):
    return {"type": name, "timestamp_ns": 1}


def test_event_buffer_assigns_sequence_and_preserves_order():
    buffer = EventBuffer(max_events=3)

    assert buffer.append(_event("one")) == 1
    assert buffer.append(_event("two")) == 2

    assert [event["type"] for event in buffer.snapshot()] == ["one", "two"]
    assert [event["sequence"] for event in buffer.snapshot()] == [1, 2]


def test_event_buffer_drops_oldest_when_full():
    buffer = EventBuffer(max_events=2)

    buffer.append(_event("one"))
    buffer.append(_event("two"))
    buffer.append(_event("three"))

    assert [event["type"] for event in buffer.snapshot()] == ["two", "three"]
    assert [event["sequence"] for event in buffer.snapshot()] == [2, 3]


def test_event_buffer_since_returns_events_after_cursor():
    buffer = EventBuffer(max_events=3)
    buffer.append(_event("one"))
    second = buffer.append(_event("two"))
    buffer.append(_event("three"))

    assert [event["type"] for event in buffer.since(second)] == ["three"]
    assert [event["type"] for event in buffer.since(None)] == ["one", "two", "three"]
    assert buffer.since(999) == []


def test_event_buffer_since_old_cursor_returns_remaining_events():
    buffer = EventBuffer(max_events=2)

    buffer.append(_event("one"))
    buffer.append(_event("two"))
    buffer.append(_event("three"))

    assert [event["type"] for event in buffer.since(0)] == ["two", "three"]


def test_event_buffer_clear_keeps_sequence_monotonic():
    buffer = EventBuffer(max_events=2)

    buffer.append(_event("one"))
    buffer.clear()
    sequence = buffer.append(_event("two"))

    assert len(buffer) == 1
    assert sequence == 2
    assert buffer.snapshot()[0]["sequence"] == 2


def test_event_buffer_snapshot_does_not_expose_internal_event_dicts():
    buffer = EventBuffer(max_events=1)
    buffer.append(_event("one"))

    snapshot = buffer.snapshot()
    snapshot[0]["type"] = "changed"

    assert buffer.snapshot()[0]["type"] == "one"


def test_event_buffer_rejects_invalid_max_events():
    with pytest.raises(ValueError, match="max_events"):
        EventBuffer(max_events=0)


def test_event_buffer_sink_writes_json_lines():
    buffer = EventBuffer(max_events=3)
    sink = EventBufferSink(buffer)

    payload = json.dumps(_event("one")) + "\n" + json.dumps(_event("two")) + "\n"
    assert sink.write(payload) == len(payload)

    assert [event["type"] for event in buffer.snapshot()] == ["one", "two"]
    assert sink.invalid_count == 0


def test_event_buffer_sink_drops_invalid_input_without_raising():
    buffer = EventBuffer(max_events=3)
    sink = EventBufferSink(buffer)

    sink.write("\n")
    sink.write("not-json\n")
    sink.write(json.dumps(["not", "an", "object"]) + "\n")
    sink.write(json.dumps(_event("valid")) + "\n")

    assert [event["type"] for event in buffer.snapshot()] == ["valid"]
    assert sink.invalid_count == 2
    assert sink.dropped_count == 2
