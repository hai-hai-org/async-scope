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

export type SourceReference = {
  file: string;
  line: number;
  function?: string | null;
};

export type SourceLocation = SourceReference & {
  function: string;
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

export type RequestStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "disconnected";

export type RequestSummary = {
  request_id: string;
  method: string | null;
  path: string | null;
  status: RequestStatus;
  status_code: number | null;
  started_at_ns: number;
  ended_at_ns: number | null;
  duration_ns: number | null;
  response_started_at_ns: number | null;
  event_count: number;
  span_count: number;
  task_count: number;
  libraries: string[];
  has_blocking: boolean;
  has_unknown_await: boolean;
};

export type RequestSort = "started_at_ns" | "duration_ns" | "status" | "path";

export type RequestOrder = "asc" | "desc";

export type RequestsQuery = {
  method?: string;
  order: RequestOrder;
  page: number;
  page_size: number;
  path?: string;
  q?: string;
  sort: RequestSort;
  status?: RequestStatus;
};

export type RequestsListPayload = {
  items: RequestSummary[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
};

export type TimeDistributionBucket =
  | "running"
  | "waiting"
  | "blocking"
  | "response"
  | "unattributed";

export type TimeDistribution = {
  duration_ns: number | null;
  measured_ns: number;
  complete: boolean;
  buckets: Record<TimeDistributionBucket, number>;
};

export type SpanNode = {
  span_id: string;
  parent_span_id: string | null;
  task_id: string | null;
  label: string | null;
  source: SourceLocation | null;
  started_at_ns: number;
  ended_at_ns: number | null;
  duration_ns: number | null;
  wait_ns: number;
  libraries: string[];
  evidence: Evidence | null;
  confidence: number | null;
  truncated: boolean;
  children: SpanNode[];
};

export type RequestDetailPayload = {
  request: RequestSummary;
  time_distribution: TimeDistribution;
  spans: SpanNode[];
  events: NormalizedEvent[];
};

export type SourceSnippetPayload = {
  file: string;
  start_line: number;
  lines: string[];
};

export type FindingType = "blocking" | "long_wait" | "unattributed";

export type FindingSeverity = "low" | "medium" | "high";

export type FindingCertainty = "observed" | "candidate" | "unknown";

export type FindingFeedbackKind = "acknowledged" | "false_positive";

export type FindingFeedback = Record<FindingFeedbackKind, boolean>;

export type FindingSuspect = {
  source: SourceLocation | null;
  label: string | null;
  span_id: string | null;
  request_id: string | null;
  certainty: FindingCertainty;
};

export type FindingRequestRef = {
  request_id: string;
  method: string | null;
  path: string | null;
  started_at_ns: number;
  ended_at_ns: number | null;
};

export type RecommendationStep = {
  text: string;
  source: SourceReference | null;
};

export type RecommendationPayload = {
  kind: string;
  certainty: FindingCertainty;
  steps: RecommendationStep[];
};

export type FindingPayload = {
  finding_id: string;
  type: FindingType;
  severity: FindingSeverity;
  title: string;
  evidence: Evidence;
  confidence: number | null;
  detected_at_ns: number;
  duration_ns: number | null;
  threshold_ns: number | null;
  suspect: FindingSuspect | null;
  affected_requests: FindingRequestRef[];
  recommendation: RecommendationPayload;
  feedback: FindingFeedback;
};

export type FindingsQuery = {
  evidence?: Evidence;
  page: number;
  page_size: number;
  request_id?: string;
  severity?: FindingSeverity;
  type?: FindingType;
};

export type FindingsListPayload = {
  items: FindingPayload[];
  total: number;
  page: number;
  page_size: number;
  has_next: boolean;
};

export type SettingsValues = {
  threshold_s: number;
  interval_s: number;
  buffer_size: number;
  project_root: string;
};

export type SettingsPatch = Partial<SettingsValues>;

export type NumericSettingLimit = {
  min: number;
  max: number;
};

export type ProjectRootLimit = {
  must_exist: boolean;
  must_be_directory: boolean;
};

export type SettingsLimits = {
  threshold_s: NumericSettingLimit;
  interval_s: NumericSettingLimit;
  buffer_size: NumericSettingLimit;
  project_root: ProjectRootLimit;
};

export type PendingRestartSettings = Partial<
  Pick<SettingsValues, "buffer_size" | "project_root">
>;

export type SettingsPayload = {
  tracing: boolean;
  persisted: boolean;
  settings: SettingsValues;
  pending_restart: PendingRestartSettings;
  limits: SettingsLimits;
  feedback: Record<FindingFeedbackKind, number>;
};

export type ApiState<T> =
  | { state: "loading"; data: null; error: null }
  | { state: "ready"; data: T; error: null }
  | { state: "empty"; data: T; error: null }
  | { state: "error"; data: null; error: { code: string; message: string } };
