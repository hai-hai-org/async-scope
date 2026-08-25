import { formatDuration } from "../shared/api/eventStore";
import type { ApiState, SummaryPayload } from "../shared/api/schemas";
import {
  Button,
  EmptyState,
  MetricCard,
  Panel,
  StatusBadge,
} from "../shared/ui";

type OverviewPageProps = {
  summary: ApiState<SummaryPayload>;
};

export function OverviewPage({ summary }: OverviewPageProps) {
  const data =
    summary.state === "ready" || summary.state === "empty"
      ? summary.data
      : null;

  return (
    <div className="dashboard-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Day13</p>
          <h2>AppShell과 summary metrics</h2>
          <p>
            모든 카드는 `GET /__asyncscope__/api/summary` shape를 기준으로
            표시하고, API가 없으면 fixture fallback으로 product 구조를 유지한다.
          </p>
        </div>
        {data ? (
          <StatusBadge
            icon="●"
            tone={data.status === "running" ? "success" : "inferred"}
          >
            {data.status}
          </StatusBadge>
        ) : null}
      </section>

      <section className="metric-grid" aria-label="Summary metrics">
        <MetricCard
          description="measured window 기준 초당 request 수"
          label="Request rate"
          state={metricState(summary)}
          unit="/s"
          value={formatNumber(data?.request_rate_per_second)}
        />
        <MetricCard
          description="window 밖에서 시작한 live request도 포함"
          label="Active requests"
          state={metricState(summary)}
          value={data?.active_requests ?? "—"}
        />
        <MetricCard
          description={`${data?.loop_delay.samples ?? 0} samples`}
          label="Loop delay"
          state={metricState(summary)}
          tone={data?.loop_delay.max_ns ? "error" : "neutral"}
          value={
            data?.loop_delay.max_ns
              ? formatDuration(data.loop_delay.max_ns)
              : "none"
          }
        />
        <MetricCard
          description="threshold를 넘은 loop.blocked count"
          label="Blocking count"
          state={metricState(summary)}
          tone={data?.blocking_count ? "error" : "neutral"}
          value={data?.blocking_count ?? "—"}
        />
        <MetricCard
          description="응답 생성 시각, event timestamp와 섞지 않음"
          label="Server time"
          state={metricState(summary)}
          value={data ? formatServerTime(data.server_time) : "—"}
        />
      </section>

      <section className="grid grid--two">
        <Panel
          actions={
            <Button size="sm" variant="ghost">
              #/timeline
            </Button>
          }
          description="buffer metadata는 SSE gap/export와 같은 필드 이름을 사용한다."
          title="Buffer"
        >
          {data ? (
            <dl className="metadata-grid">
              <div>
                <dt>events</dt>
                <dd>{data.buffer.events}</dd>
              </div>
              <div>
                <dt>max</dt>
                <dd>{data.buffer.max_events}</dd>
              </div>
              <div>
                <dt>dropped</dt>
                <dd>{data.buffer.dropped_count}</dd>
              </div>
              <div>
                <dt>source</dt>
                <dd>{data.buffer.source}</dd>
              </div>
            </dl>
          ) : (
            <EmptyState
              description="Summary API를 아직 읽지 못했지만 fixture fallback으로 화면 구조는 유지한다."
              title="Summary unavailable"
            />
          )}
        </Panel>

        <Panel
          description="Day15에서 pause/disconnected의 실제 stream 상태를 연결한다."
          title="Runtime state vocabulary"
        >
          <div className="stack">
            <StatusBadge icon="●" tone="success">
              running
            </StatusBadge>
            <StatusBadge icon="△" tone="inferred">
              paused · client render state
            </StatusBadge>
            <StatusBadge icon="!" tone="error">
              disconnected · client SSE state
            </StatusBadge>
            <StatusBadge icon="↺" tone="inferred">
              replay buffer
            </StatusBadge>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function metricState(summary: ApiState<SummaryPayload>) {
  if (summary.state === "loading") {
    return "loading";
  }
  if (summary.state === "error") {
    return "unavailable";
  }
  return summary.data.buffer.events === 0 ? "empty" : "ready";
}

function formatNumber(value: number | null | undefined) {
  if (value == null) {
    return "—";
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatServerTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return value;
  }
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
