export type RuntimeStatus = "running" | "off" | "unsupported";
export type ClientStatus = RuntimeStatus | "disconnected" | "paused";
export type BufferSource = "live" | "replay" | "mixed";
export type Evidence = "observed" | "inferred";

export type BufferMetadata = {
  events: number;
  max_events: number;
  dropped_count: number;
  first_sequence: number | null;
  last_sequence: number | null;
  source: BufferSource;
};

export type LoopDelaySummary = {
  average_ns: number | null;
  max_ns: number | null;
  samples: number;
  threshold_ns: number | null;
};

export type SummaryPayload = {
  server_time: string;
  status: RuntimeStatus;
  status_reason: string | null;
  window_ns: number;
  measured_window_ns: number;
  request_rate_per_second: number | null;
  active_requests: number;
  loop_delay: LoopDelaySummary;
  blocking_count: number;
  buffer: BufferMetadata;
};

export type SourceLocation = {
  file: string;
  function: string;
  line: number;
};

export type NormalizedEvent = {
  type: string;
  timestamp_ns: number;
  request_id: string | null;
  task_id: string | null;
  span_id: string | null;
  parent_span_id: string | null;
  source: SourceLocation | null;
  duration_ns: number | null;
  evidence: Evidence;
  confidence: number | null;
  sequence?: number;
  method?: string;
  path?: string;
  status?: string;
  status_code?: number | null;
  category?: string;
  label?: string;
  library?: string | null;
  delay_ns?: number;
  threshold_ns?: number;
  gap_start_ns?: number;
  parent_task_id?: string | null;
  outcome?: string;
  disconnect_reason?: string;
};

export type ExportPayload = {
  schema_version: "m0.normalized.v1";
  exported_at: string;
  buffer: BufferMetadata;
  events: NormalizedEvent[];
};

export type ApiState<T> =
  | { state: "loading"; data: null; error: null }
  | { state: "ready"; data: T; error: null }
  | { state: "empty"; data: T; error: null }
  | { state: "error"; data: null; error: { code: string; message: string } };
