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
