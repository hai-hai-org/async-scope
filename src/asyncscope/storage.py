"""In-memory event storage for M1 transports and query APIs.

Collectors write JSON Lines to a sink. EventBufferSink adapts that write()
interface to a bounded in-memory ring buffer so later SSE, export, metrics, and
query APIs can share the same event source.
"""

from __future__ import annotations

import json
from collections import deque
from collections.abc import Iterable


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
        # replace()로 들어온 마지막 sequence. 남아 있는 이벤트의 출처를 판정한다.
        self.replayed_through: int | None = None

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
        self.replayed_through = None

    def replace(self, events: Iterable[dict]) -> None:
        """Replay/import용 교체.

        기존 live stream metadata까지 새 입력 기준으로 다시 시작한다. 외부 입력의
        `sequence`는 append()가 storage-owned 값으로 다시 붙인다.
        """
        self._events.clear()
        self._next_sequence = 1
        self.dropped_count = 0
        for event in events:
            self.append(event)
        self.replayed_through = self.last_sequence

    @property
    def source(self) -> str:
        """남아 있는 이벤트의 출처. `live` | `replay` | `mixed`.

        bool 하나로는 안 된다. replay된 이벤트가 ring buffer에서 전부 밀려나면 buffer는
        다시 live다. `mixed`는 replay 뒤에도 tracing이 돌아 새 이벤트가 얹힌 상태다.
        """
        first, last = self.first_sequence, self.last_sequence
        if self.replayed_through is None or first is None or first > self.replayed_through:
            return "live"
        return "mixed" if last > self.replayed_through else "replay"

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
