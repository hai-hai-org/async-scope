import type { Evidence, NormalizedEvent, SourceLocation } from "./schemas";

export type SegmentKind =
  | "running"
  | "waiting"
  | "blocking"
  | "response"
  | "task"
  | "truncated";

export type TimelineSegment = {
  id: string;
  rowId: string;
  kind: SegmentKind;
  label: string;
  startNs: number;
  endNs: number;
  durationNs: number;
  evidence: Evidence;
  confidence: number | null;
  source: SourceLocation | null;
  truncated: boolean;
};

export type TimelineRow = {
  id: string;
  label: string;
  path: string;
  method: string;
  status: string;
  startNs: number;
  endNs: number;
  durationNs: number;
  segments: TimelineSegment[];
  eventCount: number;
};

export type TimelineModel = {
  axisStartNs: number;
  axisEndNs: number;
  durationNs: number;
  rows: TimelineRow[];
  backgroundSegments: TimelineSegment[];
  orderedEvents: NormalizedEvent[];
};

export function buildTimelineModel(events: NormalizedEvent[]): TimelineModel {
  const orderedEvents = [...events].sort(
    (a, b) => a.timestamp_ns - b.timestamp_ns,
  );
  const axisStartNs = orderedEvents[0]?.timestamp_ns ?? 0;
  const axisEndNs = Math.max(
    axisStartNs + 1,
    ...orderedEvents.map((event) => event.timestamp_ns),
  );
  const loopSegments = loopBlockedSegments(orderedEvents);
  const rows = requestRows(orderedEvents, loopSegments);
  const taskRow = backgroundTaskRow(orderedEvents, axisStartNs, axisEndNs);

  return {
    axisStartNs,
    axisEndNs,
    durationNs: axisEndNs - axisStartNs,
    rows: taskRow ? [...rows, taskRow] : rows,
    backgroundSegments: loopSegments,
    orderedEvents,
  };
}

export function formatDuration(ns: number | null | undefined): string {
  if (ns == null) {
    return "live";
  }
  if (ns >= 1_000_000_000) {
    return `${(ns / 1_000_000_000).toFixed(2)}s`;
  }
  if (ns >= 1_000_000) {
    return `${Math.round(ns / 1_000_000)}ms`;
  }
  if (ns >= 1_000) {
    return `${Math.round(ns / 1_000)}µs`;
  }
  return `${ns}ns`;
}

export function formatTimestamp(ns: number): string {
  return `${(ns / 1_000_000).toFixed(1)}ms`;
}

function requestRows(
  events: NormalizedEvent[],
  loopSegments: TimelineSegment[],
): TimelineRow[] {
  const grouped = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    if (event.request_id) {
      const group = grouped.get(event.request_id) ?? [];
      group.push(event);
      grouped.set(event.request_id, group);
    }
  }

  return [...grouped.entries()]
    .map(([requestId, requestEvents]) =>
      buildRequestRow(requestId, requestEvents, loopSegments),
    )
    .filter((row): row is TimelineRow => row !== null)
    .sort((a, b) => a.startNs - b.startNs);
}

function buildRequestRow(
  requestId: string,
  events: NormalizedEvent[],
  loopSegments: TimelineSegment[],
): TimelineRow | null {
  const start = events.find((event) => event.type === "request.start");
  if (!start) {
    return null;
  }
  const end = [...events]
    .reverse()
    .find((event) => event.type === "request.end");
  const endNs =
    end?.timestamp_ns ?? Math.max(...events.map((event) => event.timestamp_ns));
  const startNs = start.timestamp_ns;
  const baseLabel = `${start.method ?? "GET"} ${start.path ?? requestId}`;
  const segments = [
    ...coroutineSegments(requestId, events, startNs, endNs),
    ...responseSegments(requestId, events, endNs),
    ...loopSegments
      .filter((segment) =>
        overlaps(segment.startNs, segment.endNs, startNs, endNs),
      )
      .map((segment) => ({ ...segment, rowId: requestId })),
  ].sort((a, b) => a.startNs - b.startNs);

  return {
    id: requestId,
    label: baseLabel,
    path: start.path ?? requestId,
    method: start.method ?? "GET",
    status: end?.status ?? "running",
    startNs,
    endNs,
    durationNs: Math.max(0, endNs - startNs),
    segments,
    eventCount: events.length,
  };
}

function coroutineSegments(
  rowId: string,
  events: NormalizedEvent[],
  requestStartNs: number,
  requestEndNs: number,
): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  const bySpan = new Map<string, NormalizedEvent[]>();
  for (const event of events) {
    if (event.span_id && event.type.startsWith("coroutine.")) {
      const group = bySpan.get(event.span_id) ?? [];
      group.push(event);
      bySpan.set(event.span_id, group);
    }
  }

  for (const [spanId, spanEvents] of bySpan) {
    const ordered = spanEvents.sort((a, b) => a.timestamp_ns - b.timestamp_ns);
    const start = ordered.find((event) => event.type === "coroutine.start");
    const end = [...ordered]
      .reverse()
      .find((event) => event.type === "coroutine.end");
    if (start) {
      const endNs = end?.timestamp_ns ?? requestEndNs;
      segments.push(
        segment({
          rowId,
          id: `${spanId}-running`,
          kind: "running",
          label: start.label ?? sourceLabel(start.source) ?? "coroutine",
          startNs: start.timestamp_ns,
          endNs,
          event: start,
          truncated: false,
        }),
      );
    } else if (end) {
      const startNs = Math.max(
        requestStartNs,
        end.timestamp_ns - (end.duration_ns ?? 1_000_000),
      );
      segments.push(
        segment({
          rowId,
          id: `${spanId}-truncated`,
          kind: "truncated",
          label: `${end.label ?? "truncated"} · missing start`,
          startNs,
          endNs: end.timestamp_ns,
          event: end,
          truncated: true,
        }),
      );
    }

    for (const suspend of ordered.filter(
      (event) => event.type === "coroutine.suspend",
    )) {
      const resume = ordered.find(
        (event) =>
          event.timestamp_ns > suspend.timestamp_ns &&
          (event.type === "coroutine.resume" || event.type === "coroutine.end"),
      );
      segments.push(
        segment({
          rowId,
          id: `${spanId}-wait-${suspend.timestamp_ns}`,
          kind: "waiting",
          label: suspend.label ?? "await",
          startNs: suspend.timestamp_ns,
          endNs: resume?.timestamp_ns ?? requestEndNs,
          event: suspend,
          truncated: false,
        }),
      );
    }
  }
  return segments;
}

function responseSegments(
  rowId: string,
  events: NormalizedEvent[],
  requestEndNs: number,
): TimelineSegment[] {
  return events
    .filter((event) => event.type === "response.start")
    .map((event) =>
      segment({
        rowId,
        id: `${rowId}-response-${event.timestamp_ns}`,
        kind: "response",
        label: event.label ?? `HTTP ${event.status_code ?? ""}`,
        startNs: event.timestamp_ns,
        endNs: requestEndNs,
        event,
        truncated: false,
      }),
    );
}

function loopBlockedSegments(events: NormalizedEvent[]): TimelineSegment[] {
  return events
    .filter((event) => event.type === "loop.blocked")
    .map((event) => {
      const durationNs = event.delay_ns ?? event.duration_ns ?? 0;
      const startNs = event.gap_start_ns ?? event.timestamp_ns - durationNs;
      return segment({
        rowId: "__loop",
        id: `loop-${event.timestamp_ns}`,
        kind: "blocking",
        label: event.label ?? "loop blocked",
        startNs,
        endNs: event.timestamp_ns,
        event,
        truncated: false,
      });
    });
}

function backgroundTaskRow(
  events: NormalizedEvent[],
  axisStartNs: number,
  axisEndNs: number,
): TimelineRow | null {
  const taskEvents = events.filter((event) => event.type.startsWith("task."));
  if (taskEvents.length === 0) {
    return null;
  }
  return {
    id: "__tasks",
    label: "Background tasks",
    path: "Background tasks",
    method: "TASK",
    status: "running",
    startNs: axisStartNs,
    endNs: axisEndNs,
    durationNs: axisEndNs - axisStartNs,
    segments: taskEvents.map((event) =>
      segment({
        rowId: "__tasks",
        id: `task-${event.task_id ?? event.timestamp_ns}`,
        kind: "task",
        label: event.label ?? event.status ?? "task",
        startNs: event.timestamp_ns,
        endNs: event.timestamp_ns + (event.duration_ns ?? 1_000_000),
        event,
        truncated: false,
      }),
    ),
    eventCount: taskEvents.length,
  };
}

function segment({
  endNs,
  event,
  id,
  kind,
  label,
  rowId,
  startNs,
  truncated,
}: {
  endNs: number;
  event: NormalizedEvent;
  id: string;
  kind: SegmentKind;
  label: string;
  rowId: string;
  startNs: number;
  truncated: boolean;
}): TimelineSegment {
  const safeEndNs = Math.max(startNs + 1, endNs);
  return {
    id,
    rowId,
    kind,
    label,
    startNs,
    endNs: safeEndNs,
    durationNs: safeEndNs - startNs,
    evidence: event.evidence,
    confidence: event.confidence,
    source: event.source,
    truncated,
  };
}

function sourceLabel(source: SourceLocation | null): string | null {
  if (!source) {
    return null;
  }
  return `${source.function}()`;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return aStart < bEnd && bStart < aEnd;
}
