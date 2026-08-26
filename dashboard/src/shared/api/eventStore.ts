import type {
  Evidence,
  NormalizedEvent,
  RequestDetailPayload,
  RequestStatus,
  RequestSummary,
  SourceLocation,
  TimeDistribution,
  TimeDistributionBucket,
} from "./schemas";

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

const DISTRIBUTION_BUCKETS: TimeDistributionBucket[] = [
  "running",
  "waiting",
  "blocking",
  "response",
  "unattributed",
];

const DISTRIBUTION_RANK: Record<TimeDistributionBucket, number> = {
  running: 1,
  waiting: 2,
  response: 3,
  blocking: 4,
  unattributed: 0,
};

export function buildTimelineModel(events: NormalizedEvent[]): TimelineModel {
  const orderedEvents = [...events].sort(
    (a, b) =>
      (a.sequence ?? Number.POSITIVE_INFINITY) -
        (b.sequence ?? Number.POSITIVE_INFINITY) ||
      a.timestamp_ns - b.timestamp_ns,
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

export function mergeTimelineEvents(
  current: NormalizedEvent[],
  incoming: NormalizedEvent[],
): NormalizedEvent[] {
  const byIdentity = new Map<string, NormalizedEvent>();
  for (const event of [...current, ...incoming]) {
    byIdentity.set(eventIdentity(event), event);
  }
  return [...byIdentity.values()].sort(
    (a, b) =>
      (a.sequence ?? Number.POSITIVE_INFINITY) -
        (b.sequence ?? Number.POSITIVE_INFINITY) ||
      a.timestamp_ns - b.timestamp_ns,
  );
}

export function latestCursor(events: NormalizedEvent[]): number | null {
  const sequences = events
    .map((event) => event.sequence)
    .filter((sequence): sequence is number => typeof sequence === "number");
  return sequences.length ? Math.max(...sequences) : null;
}

export function buildFallbackRequestDetail(
  events: NormalizedEvent[],
  requestId: string,
): RequestDetailPayload | null {
  const orderedEvents = [...events].sort(
    (a, b) => a.timestamp_ns - b.timestamp_ns,
  );
  const requestEvents = orderedEvents.filter(
    (event) => event.request_id === requestId,
  );
  const start = requestEvents.find((event) => event.type === "request.start");
  if (!start) {
    return null;
  }
  const end = [...requestEvents]
    .reverse()
    .find((event) => event.type === "request.end");
  const responseStart = requestEvents.find(
    (event) => event.type === "response.start",
  );
  const startedAtNs = start.timestamp_ns;
  const endedAtNs = end?.timestamp_ns ?? null;
  const spanIds = new Set(
    requestEvents.flatMap((event) => (event.span_id ? [event.span_id] : [])),
  );
  const taskIds = new Set(
    requestEvents.flatMap((event) => (event.task_id ? [event.task_id] : [])),
  );
  const libraries = new Set(
    requestEvents.flatMap((event) =>
      typeof event.library === "string" ? [event.library] : [],
    ),
  );
  const blocked = loopBlockedGaps(orderedEvents);
  const summary: RequestSummary = {
    request_id: requestId,
    method: start.method ?? null,
    path: start.path ?? null,
    status: requestStatus(end?.status),
    status_code: end?.status_code ?? responseStart?.status_code ?? null,
    started_at_ns: startedAtNs,
    ended_at_ns: endedAtNs,
    duration_ns: end?.duration_ns ?? null,
    response_started_at_ns: responseStart?.timestamp_ns ?? null,
    event_count: requestEvents.length,
    span_count: spanIds.size,
    task_count: taskIds.size,
    libraries: [...libraries].sort(),
    has_blocking:
      requestEvents.some((event) => event.type === "loop.blocked") ||
      blocked.some(([startNs, endNs]) =>
        overlaps(startNs, endNs, startedAtNs, endedAtNs ?? startedAtNs),
      ),
    has_unknown_await: requestEvents.some(
      (event) => event.category === "unknown" || event.label === "unknown",
    ),
  };

  return {
    request: summary,
    time_distribution: buildFallbackTimeDistribution(requestEvents, blocked),
    spans: [],
    events: requestEvents,
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

function loopBlockedGaps(events: NormalizedEvent[]): Array<[number, number]> {
  return events.flatMap((event) => {
    if (event.type !== "loop.blocked") {
      return [];
    }
    const delayNs = event.delay_ns ?? event.duration_ns;
    if (!delayNs) {
      return [];
    }
    const startNs = event.gap_start_ns ?? event.timestamp_ns - delayNs;
    const endNs = Math.min(event.timestamp_ns, startNs + delayNs);
    return endNs > startNs ? [[startNs, endNs]] : [];
  });
}

function buildFallbackTimeDistribution(
  requestEvents: NormalizedEvent[],
  blocked: Array<[number, number]>,
): TimeDistribution {
  const start = requestEvents.find((event) => event.type === "request.start");
  if (!start) {
    return emptyDistribution();
  }
  const end = [...requestEvents]
    .reverse()
    .find((event) => event.type === "request.end");
  const startedAtNs = start.timestamp_ns;
  const endedAtNs =
    end?.timestamp_ns ??
    Math.max(...requestEvents.map((event) => event.timestamp_ns));
  const intervals: Array<[number, number, TimeDistributionBucket]> = [
    ...spanIntervals(requestEvents, endedAtNs),
    ...blocked.map(
      ([startNs, endNs]) =>
        [startNs, endNs, "blocking"] as [
          number,
          number,
          TimeDistributionBucket,
        ],
    ),
  ];
  const responseStart = requestEvents.find(
    (event) => event.type === "response.start",
  );
  if (responseStart) {
    intervals.push([responseStart.timestamp_ns, endedAtNs, "response"]);
  }

  return {
    duration_ns: end?.duration_ns ?? null,
    measured_ns: Math.max(0, endedAtNs - startedAtNs),
    complete: Boolean(end),
    buckets: paintDistribution([startedAtNs, endedAtNs], intervals),
  };
}

function spanIntervals(
  events: NormalizedEvent[],
  windowEndNs: number,
): Array<[number, number, TimeDistributionBucket]> {
  const openState = new Map<string, [number, TimeDistributionBucket]>();
  const intervals: Array<[number, number, TimeDistributionBucket]> = [];
  for (const event of [...events].sort(
    (a, b) => a.timestamp_ns - b.timestamp_ns,
  )) {
    if (!event.span_id || !event.type.startsWith("coroutine.")) {
      continue;
    }
    const previous = openState.get(event.span_id);
    if (previous) {
      intervals.push([previous[0], event.timestamp_ns, previous[1]]);
      openState.delete(event.span_id);
    }
    if (event.type === "coroutine.start" || event.type === "coroutine.resume") {
      openState.set(event.span_id, [event.timestamp_ns, "running"]);
    }
    if (event.type === "coroutine.suspend") {
      openState.set(event.span_id, [event.timestamp_ns, "waiting"]);
    }
  }
  for (const [startNs, bucket] of openState.values()) {
    intervals.push([startNs, windowEndNs, bucket]);
  }
  return intervals;
}

function paintDistribution(
  [windowStart, windowEnd]: [number, number],
  intervals: Array<[number, number, TimeDistributionBucket]>,
): Record<TimeDistributionBucket, number> {
  const buckets = Object.fromEntries(
    DISTRIBUTION_BUCKETS.map((bucket) => [bucket, 0]),
  ) as Record<TimeDistributionBucket, number>;
  if (windowEnd <= windowStart) {
    return buckets;
  }

  const clipped = intervals
    .map(
      ([startNs, endNs, bucket]) =>
        [
          Math.max(startNs, windowStart),
          Math.min(endNs, windowEnd),
          bucket,
        ] as [number, number, TimeDistributionBucket],
    )
    .filter(([startNs, endNs]) => endNs > startNs);
  const points = new Set([windowStart, windowEnd]);
  for (const [startNs, endNs] of clipped) {
    points.add(startNs);
    points.add(endNs);
  }
  const orderedPoints = [...points].sort((a, b) => a - b);
  for (let index = 1; index < orderedPoints.length; index += 1) {
    const startNs = orderedPoints[index - 1];
    const endNs = orderedPoints[index];
    const winner = clipped
      .filter(
        ([intervalStart, intervalEnd]) =>
          intervalStart <= startNs && endNs <= intervalEnd,
      )
      .sort(
        (a, b) => DISTRIBUTION_RANK[b[2]] - DISTRIBUTION_RANK[a[2]],
      )[0]?.[2];
    buckets[winner ?? "unattributed"] += endNs - startNs;
  }
  return buckets;
}

function emptyDistribution(): TimeDistribution {
  return {
    duration_ns: null,
    measured_ns: 0,
    complete: false,
    buckets: Object.fromEntries(
      DISTRIBUTION_BUCKETS.map((bucket) => [bucket, 0]),
    ) as Record<TimeDistributionBucket, number>,
  };
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

function requestStatus(value: string | undefined): RequestStatus {
  if (
    value === "completed" ||
    value === "failed" ||
    value === "cancelled" ||
    value === "disconnected"
  ) {
    return value;
  }
  return "running";
}

function eventIdentity(event: NormalizedEvent) {
  if (event.sequence != null) {
    return `sequence:${event.sequence}`;
  }
  return [
    event.type,
    event.timestamp_ns,
    event.request_id ?? "global",
    event.span_id ?? "no-span",
    event.task_id ?? "no-task",
    event.label ?? "event",
  ].join(":");
}
