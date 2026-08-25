import type { ReactNode } from "react";

type MetricCardProps = {
  description?: string;
  label: string;
  state?: "loading" | "ready" | "empty" | "error" | "unavailable";
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

function stateLabel(state: MetricCardProps["state"]) {
  if (state === "loading") {
    return "loading";
  }
  if (state === "empty") {
    return "empty";
  }
  if (state === "error") {
    return "error";
  }
  if (state === "unavailable") {
    return "unavailable";
  }
  return "live";
}
