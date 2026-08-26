import type { SourceLocation, SpanNode } from "../../shared/api/schemas";
import { StatusBadge } from "../../shared/ui";
import { formatDuration } from "../timeline/timeline";

type ExecutionFlowTreeProps = {
  onSelectSource: (source: SourceLocation | null) => void;
  selectedSpanId: string | null;
  spans: SpanNode[];
  onSelectSpan: (spanId: string) => void;
};

export function ExecutionFlowTree({
  onSelectSource,
  onSelectSpan,
  selectedSpanId,
  spans,
}: ExecutionFlowTreeProps) {
  if (spans.length === 0) {
    return (
      <div className="execution-flow-empty">
        <strong>Execution Flow 없음</strong>
        <span>request detail에 span tree가 없거나 앞 이벤트가 밀려났다.</span>
      </div>
    );
  }

  return (
    <ul className="execution-flow" aria-label="Execution Flow">
      {spans.map((span) => (
        <SpanTreeItem
          key={span.span_id}
          onSelectSource={onSelectSource}
          onSelectSpan={onSelectSpan}
          selectedSpanId={selectedSpanId}
          span={span}
        />
      ))}
    </ul>
  );
}

function SpanTreeItem({
  onSelectSource,
  onSelectSpan,
  selectedSpanId,
  span,
}: {
  onSelectSource: (source: SourceLocation | null) => void;
  onSelectSpan: (spanId: string) => void;
  selectedSpanId: string | null;
  span: SpanNode;
}) {
  const selected = selectedSpanId === span.span_id;
  return (
    <li
      aria-current={selected ? "true" : undefined}
      className="execution-flow__item"
    >
      <button
        className="execution-flow__button"
        onClick={() => {
          onSelectSpan(span.span_id);
          onSelectSource(span.source);
        }}
        type="button"
      >
        <span className="execution-flow__label">
          <span aria-hidden="true">{span.source ? "↗" : "∅"}</span>
          <strong>{span.label ?? span.span_id}</strong>
        </span>
        <span className="execution-flow__meta">
          {formatDuration(span.duration_ns)} · wait{" "}
          {formatDuration(span.wait_ns)}
        </span>
        <span className="execution-flow__badges">
          <StatusBadge
            icon={span.evidence === "observed" ? "●" : "△"}
            tone={span.evidence === "observed" ? "observed" : "inferred"}
          >
            {span.evidence ?? "inferred"}
          </StatusBadge>
          {span.truncated ? (
            <StatusBadge icon="…" tone="inferred">
              truncated
            </StatusBadge>
          ) : null}
          {span.source ? null : (
            <StatusBadge icon="∅" tone="inferred">
              missing source
            </StatusBadge>
          )}
        </span>
      </button>
      {span.children.length ? (
        <ul className="execution-flow__children">
          {span.children.map((child) => (
            <SpanTreeItem
              key={child.span_id}
              onSelectSource={onSelectSource}
              onSelectSpan={onSelectSpan}
              selectedSpanId={selectedSpanId}
              span={child}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
