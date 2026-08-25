import type { NormalizedEvent } from "./schemas";

export type SseStatus =
  | "idle"
  | "connecting"
  | "open"
  | "disconnected"
  | "gap"
  | "error";

export type ParsedSseFrame =
  | { event: "asyncscope.event"; id: number; data: NormalizedEvent }
  | {
      event: "asyncscope.gap";
      id: null;
      data: {
        error: "event_gap";
        cursor: number | null;
        first_sequence: number | null;
        last_sequence: number | null;
        dropped_count: number;
      };
    };

export function eventSourceUrl(cursor?: number | null) {
  const params = new URLSearchParams();
  if (cursor != null) {
    params.set("cursor", String(cursor));
  }
  const query = params.toString();
  return `/__asyncscope__/api/events${query ? `?${query}` : ""}`;
}
