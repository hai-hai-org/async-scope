"""JSON export/replay payloads for the internal API."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from .analysis import QueryError

SCHEMA_VERSION = "m0.normalized.v1"


def export_payload(buffer, *, exported_at: str | None = None) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "exported_at": exported_at or datetime.now(UTC).isoformat(),
        "buffer": buffer_metadata(buffer),
        "events": buffer.snapshot(),
    }


def replay_into(buffer, payload: dict[str, Any]) -> dict[str, Any]:
    events = validate_replay_payload(payload)
    buffer.replace(events)
    return export_payload(buffer)


def clear_buffer(buffer) -> dict[str, Any]:
    """버퍼를 비우고 지금부터 새로 추적한다.

    `export_payload`와 같은 모양으로 돌려줘서 클라이언트가 별도 응답 스키마 없이
    이미 아는 `ExportPayload`로 처리할 수 있다.
    """
    buffer.clear()
    return export_payload(buffer)


def validate_replay_payload(payload: dict[str, Any]) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise QueryError("replay payload must be an object")
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise QueryError(f"schema_version must be {SCHEMA_VERSION}")

    events = payload.get("events")
    if not isinstance(events, list):
        raise QueryError("events must be a list")

    cleaned = []
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            raise QueryError(f"events[{index}] must be an object")
        cleaned.append(_strip_transport_metadata(event))
    return cleaned


def buffer_metadata(buffer) -> dict[str, Any]:
    return {
        "events": len(buffer),
        "max_events": buffer.max_events,
        "dropped_count": buffer.dropped_count,
        "first_sequence": buffer.first_sequence,
        "last_sequence": buffer.last_sequence,
        "source": buffer.source,
    }


def _strip_transport_metadata(event: dict[str, Any]) -> dict[str, Any]:
    cleaned = dict(event)
    cleaned.pop("sequence", None)
    return cleaned
