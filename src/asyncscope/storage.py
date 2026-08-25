"""In-memory event storage for M1 transports and query APIs.

Collectors write JSON Lines to a sink. EventBufferSink adapts that write()
interface to a bounded in-memory ring buffer so later SSE, export, metrics, and
query APIs can share the same event source.
"""

from __future__ import annotations

import json
from collections import deque


class EventBuffer:
    """Bounded in-memory buffer for normalized events.

    `sequence` is storage-owned transport metadata. Collectors do not emit it.
    """

    def __init__(self, max_events: int = 1000):
        if max_events < 1:
            raise ValueError("max_events must be greater than 0")
        self.max_events = max_events
        self._events = deque()
        self._next_sequence = 1
        self.dropped_count = 0

    def append(self, event: dict) -> int:
        sequence = self._next_sequence
        self._next_sequence += 1
        stored = dict(event)
        stored["sequence"] = sequence
        if len(self._events) == self.max_events:
            self._events.popleft()
            self.dropped_count += 1
        self._events.append(stored)
        return sequence

    @property
    def first_sequence(self) -> int | None:
        return self._sequence_at(0)

    @property
    def last_sequence(self) -> int | None:
        return self._sequence_at(-1)

    def snapshot(self) -> list[dict]:
        return [dict(event) for event in self._events]

    def since(self, cursor: int | None) -> list[dict]:
        if cursor is None:
            return self.snapshot()
        return [dict(event) for event in self._events if event["sequence"] > cursor]

    def cursor_was_dropped(self, cursor: int | None) -> bool:
        first_sequence = self.first_sequence
        return (
            cursor is not None
            and first_sequence is not None
            and cursor < first_sequence - 1
        )

    def clear(self) -> None:
        self._events.clear()

    def __len__(self) -> int:
        return len(self._events)

    def _sequence_at(self, index: int) -> int | None:
        if not self._events:
            return None
        return self._events[index]["sequence"]


class EventBufferSink:
    """JSON Lines write() adapter backed by EventBuffer.

    Invalid input is dropped. A tracing sink must not break the target app.
    """

    def __init__(self, buffer: EventBuffer):
        self.buffer = buffer
        self.invalid_count = 0

    def write(self, text: str) -> int:
        for line in text.splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                self.invalid_count += 1
                continue
            if not isinstance(event, dict):
                self.invalid_count += 1
                continue
            self.buffer.append(event)
        return len(text)

    @property
    def dropped_count(self) -> int:
        return self.buffer.dropped_count
