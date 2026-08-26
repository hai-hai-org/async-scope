import type {
  RequestDetailPayload,
  RequestStatus,
  TimeDistributionBucket,
} from "../../shared/api/schemas";
import { Button, EmptyState, Panel, StatusBadge } from "../../shared/ui";
import type { TimelineSegment } from "./timeline";
import { formatDuration } from "./timeline";

type RequestInspectorState =
  | "idle"
  | "loading"
  | "ready"
  | "fallback"
  | "error";

type RequestInspectorProps = {
  detail: RequestDetailPayload | null;
  errorMessage?: string | null;
  onRetry: () => void;
  selectedSegment: TimelineSegment | null;
  state: RequestInspectorState;
};

const BUCKETS: TimeDistributionBucket[] = [
  "running",
  "waiting",
  "blocking",
  "response",
  "unattributed",
];

export function RequestInspector({
  detail,
  errorMessage,
  onRetry,
  selectedSegment,
  state,
}: RequestInspectorProps) {
  if (!selectedSegment) {
    return (
      <Panel
        description="Timeline segment를 선택하면 request metadata와 시간 분포를 보여 준다."
        title="RequestInspector"
      >
        <EmptyState
          description="segment button에 focus한 뒤 Enter 또는 Space로 선택할 수 있다."
          title="선택된 request 없음"
        />
      </Panel>
    );
  }

  if (selectedSegment.rowId === "__tasks") {
    return (
      <Panel
        description="background task는 request_id가 없으므로 request detail API 대상이 아니다."
        title="RequestInspector"
      >
        <EmptyState
          description={`${selectedSegment.label} · ${formatDuration(
            selectedSegment.durationNs,
          )}`}
          title="Background task segment"
        />
      </Panel>
    );
  }

  if (state === "loading") {
    return (
      <Panel
        description="request detail API를 불러오는 중이다."
        state="loading"
        title="RequestInspector"
      >
        <span />
      </Panel>
    );
  }

  if (!detail) {
    return (
      <Panel
        actions={
          <Button onClick={onRetry} size="sm" variant="ghost">
            Retry
          </Button>
        }
        description={errorMessage ?? "request detail을 아직 만들 수 없다."}
        title="RequestInspector"
      >
        <EmptyState
          description="fixture나 live event에 request.start가 없으면 metadata를 복원하지 않는다."
          title="Request detail unavailable"
        />
      </Panel>
    );
  }

  return (
    <Panel
      actions={
        state === "fallback" ? (
          <StatusBadge icon="△" tone="inferred">
            event fallback
          </StatusBadge>
        ) : (
          <StatusBadge icon="●" tone="observed">
            request API
          </StatusBadge>
        )
      }
      description="선택된 Timeline segment가 속한 request의 metadata와 TimeDistribution이다."
      title="RequestInspector"
    >
      <div className="request-inspector">
        <header className="request-inspector__header">
          <div>
            <p className="eyebrow">selected request</p>
            <h4>{requestTitle(detail)}</h4>
          </div>
          <StatusBadge
            icon={statusIcon(detail.request.status)}
            tone={statusTone(detail.request.status)}
          >
            {detail.request.status}
          </StatusBadge>
        </header>

        <dl className="metadata-grid">
          <div>
            <dt>request_id</dt>
            <dd className="mono">{detail.request.request_id}</dd>
          </div>
          <div>
            <dt>duration</dt>
            <dd>
              {formatDuration(
                detail.request.duration_ns ??
                  detail.time_distribution.measured_ns,
              )}
            </dd>
          </div>
          <div>
            <dt>status_code</dt>
            <dd>{detail.request.status_code ?? "—"}</dd>
          </div>
          <div>
            <dt>events</dt>
            <dd>{detail.request.event_count}</dd>
          </div>
          <div>
            <dt>spans</dt>
            <dd>{detail.request.span_count}</dd>
          </div>
          <div>
            <dt>tasks</dt>
            <dd>{detail.request.task_count}</dd>
          </div>
          <div>
            <dt>flags</dt>
            <dd>
              {detail.request.has_blocking ? "blocking" : "no blocking"} ·{" "}
              {detail.request.has_unknown_await
                ? "unknown await"
                : "known awaits"}
            </dd>
          </div>
          <div>
            <dt>libraries</dt>
            <dd>{detail.request.libraries.join(", ") || "—"}</dd>
          </div>
        </dl>

        <section aria-label="Time distribution" className="time-distribution">
          <div className="time-distribution__header">
            <strong>TimeDistribution</strong>
            <span>
              {detail.time_distribution.complete ? "complete" : "live/partial"}{" "}
              · {formatDuration(detail.time_distribution.measured_ns)}
            </span>
          </div>
          <div className="time-distribution__bar" aria-hidden="true">
            {BUCKETS.filter(
              (bucket) => detail.time_distribution.buckets[bucket] > 0,
            ).map((bucket) => (
              <span
                className={`time-distribution__slice time-distribution__slice--${bucket}`}
                key={bucket}
                style={{
                  inlineSize: `${bucketRatio(detail, bucket)}%`,
                }}
              />
            ))}
          </div>
          <dl className="time-distribution__legend">
            {BUCKETS.map((bucket) => (
              <div key={bucket}>
                <dt>{bucket}</dt>
                <dd>
                  {formatDuration(detail.time_distribution.buckets[bucket])}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="inspector-next">
          <div>
            <strong>Execution Flow</strong>
            <span>{detail.spans.length} root span nodes · Day17 연결 지점</span>
          </div>
          <div>
            <strong>Source</strong>
            <span>safe source viewer는 Day17에서 read-only로 연결</span>
          </div>
        </section>
      </div>
    </Panel>
  );
}

function requestTitle(detail: RequestDetailPayload) {
  return `${detail.request.method ?? "GET"} ${detail.request.path ?? detail.request.request_id}`;
}

function bucketRatio(
  detail: RequestDetailPayload,
  bucket: TimeDistributionBucket,
) {
  const total = Math.max(1, detail.time_distribution.measured_ns);
  return Math.max(0, (detail.time_distribution.buckets[bucket] / total) * 100);
}

function statusTone(status: RequestStatus) {
  if (status === "completed") {
    return "success";
  }
  if (
    status === "failed" ||
    status === "cancelled" ||
    status === "disconnected"
  ) {
    return "error";
  }
  return "inferred";
}

function statusIcon(status: RequestStatus) {
  if (status === "completed") {
    return "✓";
  }
  if (status === "running") {
    return "●";
  }
  return "!";
}
