import { useEffect, useMemo, useState } from "react";
import type {
  RequestDetailPayload,
  RequestStatus,
  SourceLocation,
  SpanNode,
  TimeDistributionBucket,
} from "../../shared/api/schemas";
import { Button, EmptyState, Panel, StatusBadge } from "../../shared/ui";
import { formatDuration } from "../timeline/timeline";
import { ExecutionFlowTree } from "./ExecutionFlowTree";
import { SourceViewer } from "./SourceViewer";
import type { RequestDetailState } from "./useRequestDetail";

type RequestDetailPanelProps = {
  detailState: RequestDetailState;
  emptyDescription: string;
  emptyTitle: string;
  initialSource?: SourceLocation | null;
  onRetry: () => void;
  title?: string;
};

const BUCKETS: TimeDistributionBucket[] = [
  "running",
  "waiting",
  "blocking",
  "response",
  "unattributed",
];

export function RequestDetailPanel({
  detailState,
  emptyDescription,
  emptyTitle,
  initialSource = null,
  onRetry,
  title = "Request detail",
}: RequestDetailPanelProps) {
  const detail = detailState.data;
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<SourceLocation | null>(
    initialSource,
  );
  const firstSpan = useMemo(
    () => (detail ? firstSpanNode(detail.spans) : null),
    [detail],
  );

  useEffect(() => {
    setSelectedSpanId(firstSpan?.span_id ?? null);
    setSelectedSource(initialSource ?? firstSpan?.source ?? null);
  }, [firstSpan, initialSource]);

  if (detailState.state === "idle") {
    return (
      <Panel
        description="request를 선택하면 실행 흐름과 source를 함께 보여 준다."
        title={title}
      >
        <EmptyState description={emptyDescription} title={emptyTitle} />
      </Panel>
    );
  }

  if (detailState.state === "loading") {
    return (
      <Panel
        description="request detail API를 불러오는 중이다."
        state="loading"
        title={title}
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
        description={detailState.error ?? "request detail을 만들 수 없다."}
        title={title}
      >
        <EmptyState
          description="request가 buffer에서 밀렸거나 API를 사용할 수 없는 상태일 수 있다."
          title="Request detail unavailable"
        />
      </Panel>
    );
  }

  return (
    <Panel
      actions={
        detailState.state === "fallback" ? (
          <StatusBadge icon="△" tone="inferred">
            event fallback
          </StatusBadge>
        ) : (
          <StatusBadge icon="●" tone="observed">
            request API
          </StatusBadge>
        )
      }
      description="request metadata, 시간 분포, span tree와 safe source snippet을 함께 표시한다."
      title={title}
    >
      <div className="request-detail">
        <header className="request-detail__header">
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

        <RequestMetadata detail={detail} />
        <TimeDistributionView detail={detail} />

        <div className="request-detail__flow-grid">
          <section
            aria-label="Execution Flow"
            className="request-detail__section"
          >
            <div className="request-detail__section-header">
              <strong>Execution Flow</strong>
              <span>{detail.spans.length} root spans</span>
            </div>
            <ExecutionFlowTree
              onSelectSource={setSelectedSource}
              onSelectSpan={setSelectedSpanId}
              selectedSpanId={selectedSpanId}
              spans={detail.spans}
            />
          </section>
          <SourceViewer source={selectedSource} />
        </div>
      </div>
    </Panel>
  );
}

function RequestMetadata({ detail }: { detail: RequestDetailPayload }) {
  return (
    <dl className="metadata-grid">
      <div>
        <dt>request_id</dt>
        <dd className="mono">{detail.request.request_id}</dd>
      </div>
      <div>
        <dt>duration</dt>
        <dd>
          {formatDuration(
            detail.request.duration_ns ?? detail.time_distribution.measured_ns,
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
          {detail.request.has_unknown_await ? "unknown await" : "known awaits"}
        </dd>
      </div>
      <div>
        <dt>libraries</dt>
        <dd>{detail.request.libraries.join(", ") || "—"}</dd>
      </div>
    </dl>
  );
}

function TimeDistributionView({ detail }: { detail: RequestDetailPayload }) {
  return (
    <section aria-label="Time distribution" className="time-distribution">
      <div className="time-distribution__header">
        <strong>TimeDistribution</strong>
        <span>
          {detail.time_distribution.complete ? "complete" : "live/partial"} ·{" "}
          {formatDuration(detail.time_distribution.measured_ns)}
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
            <dd>{formatDuration(detail.time_distribution.buckets[bucket])}</dd>
          </div>
        ))}
      </dl>
    </section>
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

function firstSpanNode(spans: SpanNode[]): SpanNode | null {
  for (const span of spans) {
    if (span.source) {
      return span;
    }
    const child = firstSpanNode(span.children);
    if (child) {
      return child;
    }
  }
  return spans[0] ?? null;
}
