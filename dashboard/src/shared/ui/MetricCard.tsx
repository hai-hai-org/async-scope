import type { ReactNode } from "react";

type MetricCardProps = {
  description?: string;
  label: string;
  state?: "loading" | "ready" | "empty" | "stale" | "error" | "unavailable";
  tone?: "neutral" | "success" | "warning" | "error";
  unit?: string;
  value: ReactNode;
};

export function MetricCard({
  description,
  label,
  state = "ready",
  tone = "neutral",
  unit,
  value,
}: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`} data-state={state}>
      <div className="metric-card__header">
        <span>{label}</span>
        <span className="metric-card__state">{stateLabel(state)}</span>
      </div>
      <div className="metric-card__value">
        {state === "loading" ? <span className="skeleton" /> : value}
        {unit ? <span className="metric-card__unit">{unit}</span> : null}
      </div>
      {description ? <p>{description}</p> : null}
    </article>
  );
}

// DESIGN.md §5: loading / live / stale / unavailable / error.
// "live"는 실제로 방금 읽은 값일 때만 쓴다.
function stateLabel(state: MetricCardProps["state"]) {
  if (state === "loading") {
    return "불러오는 중";
  }
  if (state === "empty") {
    return "데이터 없음";
  }
  if (state === "stale") {
    return "갱신 안 됨";
  }
  if (state === "error") {
    return "오류";
  }
  if (state === "unavailable") {
    return "연결 없음";
  }
  return "live";
}
