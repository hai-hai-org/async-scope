import { useCallback, useEffect, useRef, useState } from "react";
import type { NormalizedEvent } from "./schemas";
import { eventSourceUrl, type SseGapPayload, type SseStatus } from "./sse";

type UseEventStreamOptions = {
  enabled?: boolean;
  initialCursor?: number | null;
  onEvent: (event: NormalizedEvent) => void;
  onGap: (gap: SseGapPayload) => void;
};

type EventStreamState = {
  gap: SseGapPayload | null;
  lastCursor: number | null;
  reconnect: (cursor?: number | null) => void;
  status: SseStatus;
};

export function useEventStream({
  enabled = true,
  initialCursor = null,
  onEvent,
  onGap,
}: UseEventStreamOptions): EventStreamState {
  const [status, setStatus] = useState<SseStatus>(
    enabled ? "connecting" : "idle",
  );
  const [gap, setGap] = useState<SseGapPayload | null>(null);
  const [lastCursor, setLastCursor] = useState<number | null>(
    initialCursor ?? null,
  );
  const [connection, setConnection] = useState({
    cursor: initialCursor ?? null,
    token: 0,
  });
  const cursorRef = useRef<number | null>(initialCursor ?? null);
  const eventHandlerRef = useRef(onEvent);
  const gapHandlerRef = useRef(onGap);

  useEffect(() => {
    eventHandlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    gapHandlerRef.current = onGap;
  }, [onGap]);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      return;
    }

    if (initialCursor != null && cursorRef.current == null) {
      cursorRef.current = initialCursor;
      setLastCursor(initialCursor);
    }
  }, [enabled, initialCursor]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    setStatus("connecting");
    setGap(null);

    const cursor =
      connection.token === 0 && initialCursor != null
        ? initialCursor
        : connection.cursor;
    const source = new EventSource(eventSourceUrl(cursor));
    source.addEventListener("open", () => {
      setStatus("open");
    });
    source.addEventListener("asyncscope.event", (event) => {
      const cursor = Number.parseInt(event.lastEventId, 10);
      const payload = parseJson<NormalizedEvent>(event.data);
      if (!payload) {
        setStatus("error");
        return;
      }
      const nextEvent =
        Number.isFinite(cursor) && payload.sequence == null
          ? { ...payload, sequence: cursor }
          : payload;
      if (Number.isFinite(cursor)) {
        cursorRef.current = cursor;
        setLastCursor(cursor);
      }
      eventHandlerRef.current(nextEvent);
    });
    source.addEventListener("asyncscope.gap", (event) => {
      const payload = parseJson<SseGapPayload>(event.data);
      if (!payload) {
        setStatus("error");
        return;
      }
      setGap(payload);
      setStatus("gap");
      source.close();
      gapHandlerRef.current(payload);
    });
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        setStatus("disconnected");
        return;
      }
      setStatus("disconnected");
    };

    return () => {
      source.close();
    };
  }, [connection, enabled, initialCursor]);

  const reconnect = useCallback((cursor?: number | null) => {
    cursorRef.current = cursor ?? null;
    setLastCursor(cursor ?? null);
    setGap(null);
    setConnection((current) => ({
      cursor: cursor ?? null,
      token: current.token + 1,
    }));
  }, []);

  return { gap, lastCursor, reconnect, status };
}

function parseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}
