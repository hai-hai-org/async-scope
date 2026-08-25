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
    assert buffer.first_sequence == 1
    assert buffer.last_sequence == 2
    assert buffer.dropped_count == 0


def test_event_buffer_drops_oldest_when_full():
    buffer = EventBuffer(max_events=2)

    buffer.append(_event("one"))
    buffer.append(_event("two"))
    buffer.append(_event("three"))

    assert [event["type"] for event in buffer.snapshot()] == ["two", "three"]
    assert [event["sequence"] for event in buffer.snapshot()] == [2, 3]
    assert buffer.first_sequence == 2
    assert buffer.last_sequence == 3
    assert buffer.dropped_count == 1


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
    assert buffer.cursor_was_dropped(0)
    assert not buffer.cursor_was_dropped(1)
    assert not buffer.cursor_was_dropped(3)
    assert not buffer.cursor_was_dropped(None)


def test_event_buffer_clear_keeps_sequence_monotonic():
    buffer = EventBuffer(max_events=2)

    buffer.append(_event("one"))
    buffer.clear()
    assert buffer.first_sequence is None
    assert buffer.last_sequence is None
    sequence = buffer.append(_event("two"))

    assert len(buffer) == 1
    assert sequence == 2
    assert buffer.snapshot()[0]["sequence"] == 2
    assert buffer.first_sequence == 2
    assert buffer.last_sequence == 2


def test_event_buffer_replace_resets_transport_metadata():
    buffer = EventBuffer(max_events=2)

    buffer.append(_event("old"))
    buffer.replace([_event("one"), _event("two"), _event("three")])

    assert [event["type"] for event in buffer.snapshot()] == ["two", "three"]
    assert [event["sequence"] for event in buffer.snapshot()] == [2, 3]
    assert buffer.first_sequence == 2
    assert buffer.last_sequence == 3
    assert buffer.dropped_count == 1


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
    assert sink.dropped_count == 0


def test_event_buffer_sink_reports_overflow_drops_separately_from_invalid_input():
    buffer = EventBuffer(max_events=1)
    sink = EventBufferSink(buffer)

    sink.write("not-json\n")
    sink.write(json.dumps(_event("one")) + "\n")
    sink.write(json.dumps(_event("two")) + "\n")

    assert [event["type"] for event in buffer.snapshot()] == ["two"]
    assert sink.invalid_count == 1
    assert sink.dropped_count == 1


def test_source_tracks_where_the_remaining_events_came_from():
    """지금 보는 게 live인지 replay인지 소비자가 알아야 한다."""
    buffer = EventBuffer(max_events=4)
    assert buffer.source == "live"

    buffer.append({"type": "live"})
    assert buffer.source == "live"

    buffer.replace([{"type": "replayed"}, {"type": "replayed"}])
    assert buffer.source == "replay"
    assert buffer.replayed_through == 2

    # replay 뒤에도 tracing이 돌면 남의 capture 위에 새 이벤트가 얹힌다.
    buffer.append({"type": "live"})
    assert buffer.source == "mixed"

    # replay된 이벤트가 전부 밀려나면 buffer는 다시 live다. bool 하나로는 안 된다.
    for _ in range(3):
        buffer.append({"type": "live"})
    assert buffer.first_sequence > buffer.replayed_through
    assert buffer.source == "live"


def test_clear_forgets_the_replay_trace():
    buffer = EventBuffer(max_events=4)
    buffer.replace([{"type": "replayed"}])
    assert buffer.source == "replay"

    buffer.clear()
    assert buffer.replayed_through is None
    assert buffer.source == "live"
