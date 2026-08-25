import pytest

from asyncscope.analysis import QueryError
from asyncscope.export import (
    SCHEMA_VERSION,
    export_payload,
    replay_into,
    validate_replay_payload,
)
from asyncscope.storage import EventBuffer


def _event(event_type: str, timestamp_ns: int = 1) -> dict:
    return {
        "type": event_type,
        "timestamp_ns": timestamp_ns,
        "request_id": None,
        "task_id": None,
        "span_id": None,
        "parent_span_id": None,
        "source": None,
        "duration_ns": None,
        "evidence": "observed",
        "confidence": None,
    }


def test_export_payload_reports_buffer_snapshot_and_metadata():
    buffer = EventBuffer(max_events=2)
    buffer.append(_event("one", 1))
    buffer.append(_event("two", 2))

    payload = export_payload(buffer, exported_at="2026-08-25T00:00:00+00:00")

    assert payload["schema_version"] == SCHEMA_VERSION
    assert payload["exported_at"] == "2026-08-25T00:00:00+00:00"
    assert payload["buffer"] == {
        "events": 2,
        "max_events": 2,
        "dropped_count": 0,
        "first_sequence": 1,
        "last_sequence": 2,
    }
    assert [event["type"] for event in payload["events"]] == ["one", "two"]
    assert [event["sequence"] for event in payload["events"]] == [1, 2]


def test_replay_replaces_buffer_and_strips_input_sequence():
    buffer = EventBuffer(max_events=10)
    buffer.append(_event("old", 1))
    payload = {
        "schema_version": SCHEMA_VERSION,
        "events": [
            {**_event("new", 10), "sequence": 999},
            _event("next", 20),
        ],
    }

    result = replay_into(buffer, payload)

    assert [event["type"] for event in buffer.snapshot()] == ["new", "next"]
    assert [event["sequence"] for event in buffer.snapshot()] == [1, 2]
    assert result["buffer"]["first_sequence"] == 1
    assert result["buffer"]["last_sequence"] == 2
    assert result["events"][0]["sequence"] == 1


def test_replay_uses_buffer_limit_and_reports_replay_drops():
    buffer = EventBuffer(max_events=2)

    result = replay_into(
        buffer,
        {
            "schema_version": SCHEMA_VERSION,
            "events": [_event("one", 1), _event("two", 2), _event("three", 3)],
        },
    )

    assert [event["type"] for event in result["events"]] == ["two", "three"]
    assert [event["sequence"] for event in result["events"]] == [2, 3]
    assert result["buffer"]["dropped_count"] == 1


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ([], "replay payload must be an object"),
        ({}, "schema_version must be"),
        ({"schema_version": "other", "events": []}, "schema_version must be"),
        ({"schema_version": SCHEMA_VERSION}, "events must be a list"),
        ({"schema_version": SCHEMA_VERSION, "events": ["bad"]}, "events\\[0\\]"),
    ],
)
def test_validate_replay_payload_rejects_invalid_input(payload, message):
    with pytest.raises(QueryError, match=message):
        validate_replay_payload(payload)
