import adapterFixture from "../../../contracts/fixtures/adapter-awaits.json";
import backgroundTaskFixture from "../../../contracts/fixtures/background-task.json";
import blockingFixture from "../../../contracts/fixtures/blocking.json";
import disconnectFixture from "../../../contracts/fixtures/disconnect.json";
import failureCancelFixture from "../../../contracts/fixtures/failure-cancel.json";
import timelineFixture from "../../../contracts/fixtures/timeline.json";
import unknownAwaitFixture from "../../../contracts/fixtures/unknown-await.json";
import type {
  ExportPayload,
  NormalizedEvent,
  SummaryPayload,
} from "../shared/api/schemas";

export type UiSection<T> = {
  state: "loading" | "empty" | "ready" | "error";
  data: T | null;
  error: { code: string; message: string } | null;
};

export type UiStateFixture = {
  schema_version: "m1.ui-state.v1";
  state: "loading" | "empty" | "error";
  summary: UiSection<unknown>;
  requests: UiSection<unknown> & { selected: string | null };
  findings: UiSection<unknown> & { selected: string | null };
  settings: UiSection<unknown>;
  events: UiSection<unknown>;
};

export const uiStateFixtures: Record<string, UiStateFixture> = {
  loading: {
    schema_version: "m1.ui-state.v1",
    state: "loading",
    summary: { state: "loading", data: null, error: null },
    requests: { state: "loading", data: null, selected: null, error: null },
    findings: { state: "loading", data: null, selected: null, error: null },
    settings: { state: "loading", data: null, error: null },
    events: { state: "loading", data: null, error: null },
  },
  empty: {
    schema_version: "m1.ui-state.v1",
    state: "empty",
    summary: {
      state: "empty",
      data: {
        request_rate_per_second: null,
        active_requests: 0,
        blocking_count: 0,
        buffer: { events: 0 },
      },
      error: null,
    },
    requests: {
      state: "empty",
      data: { items: [], total: 0, page: 1, page_size: 50, has_next: false },
      selected: null,
      error: null,
    },
    findings: {
      state: "empty",
      data: { items: [], total: 0, page: 1, page_size: 50, has_next: false },
      selected: null,
      error: null,
    },
    settings: {
      state: "ready",
      data: { persisted: false, pending_restart: {} },
      error: null,
    },
    events: {
      state: "empty",
      data: { items: [], cursor: null, gap: null },
      error: null,
    },
  },
  error: {
    schema_version: "m1.ui-state.v1",
    state: "error",
    summary: {
      state: "error",
      data: null,
      error: { code: "api_error", message: "summary unavailable" },
    },
    requests: {
      state: "error",
      data: null,
      selected: null,
      error: { code: "api_error", message: "requests unavailable" },
    },
    findings: {
      state: "error",
      data: null,
      selected: null,
      error: { code: "api_error", message: "findings unavailable" },
    },
    settings: {
      state: "error",
      data: null,
      error: { code: "bad_request", message: "invalid settings payload" },
    },
    events: {
      state: "error",
      data: {
        items: [],
        cursor: 0,
        gap: {
          error: "event_gap",
          cursor: 0,
          first_sequence: 4,
          last_sequence: 10,
          dropped_count: 3,
        },
      },
      error: { code: "event_gap", message: "event buffer gap" },
    },
  },
};

export const requestRows = [
  {
    id: "req-1",
    path: "/demo/non-blocking",
    status: "completed",
    duration: "57ms",
    evidence: "observed",
  },
  {
    id: "req-2",
    path: "/demo/blocking/with/a/very/long/path/that/must/truncate/in/table",
    status: "blocking",
    duration: "313ms",
    evidence: "inferred",
  },
  {
    id: "req-3",
    path: "/demo/unknown-await",
    status: "running",
    duration: "live",
    evidence: "observed",
  },
];

export const eventFixtures = {
  timeline: timelineFixture.events as unknown as NormalizedEvent[],
  blocking: blockingFixture.events as unknown as NormalizedEvent[],
  unknownAwait: unknownAwaitFixture.events as unknown as NormalizedEvent[],
  adapterAwaits: adapterFixture.events as unknown as NormalizedEvent[],
  failureCancel: failureCancelFixture.events as unknown as NormalizedEvent[],
  disconnect: disconnectFixture.events as unknown as NormalizedEvent[],
  backgroundTask: backgroundTaskFixture.events as unknown as NormalizedEvent[],
};

export const fallbackExport: ExportPayload = {
  schema_version: "m0.normalized.v1",
  exported_at: "2026-08-25T00:00:00+00:00",
  buffer: {
    events: eventFixtures.timeline.length,
    max_events: 1000,
    dropped_count: 0,
    first_sequence: 1,
    last_sequence: eventFixtures.timeline.length,
    source: "replay",
  },
  events: eventFixtures.timeline.map((event, index) => ({
    ...event,
    sequence: index + 1,
  })),
};

export const fallbackSummary: SummaryPayload = {
  server_time: "2026-08-25T00:00:00+00:00",
  status: "running",
  status_reason: null,
  window_ns: 60_000_000_000,
  measured_window_ns: 57_000_000,
  request_rate_per_second: 35.088,
  active_requests: 0,
  loop_delay: {
    average_ns: null,
    max_ns: null,
    samples: 0,
    threshold_ns: null,
  },
  blocking_count: 0,
  buffer: {
    events: fallbackExport.events.length,
    max_events: 1000,
    dropped_count: 0,
    first_sequence: 1,
    last_sequence: fallbackExport.events.length,
    source: "replay",
  },
};
