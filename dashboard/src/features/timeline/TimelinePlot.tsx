import { useMemo } from "react";
import type { TimelineModel, TimelineSegment } from "./timeline";
import { formatDuration, segmentOffset, segmentWidth } from "./timeline";

type TimelinePlotProps = {
  model: TimelineModel;
  onSelectSegment: (id: string) => void;
  selectedSegmentId: string | null;
};

const TICK_COUNT = 5;

export function TimelinePlot({
  model,
  onSelectSegment,
  selectedSegmentId,
}: TimelinePlotProps) {
  const ticks = useMemo(
    () =>
      Array.from({ length: TICK_COUNT }, (_, index) => {
        const ratio = index / (TICK_COUNT - 1);
        return {
          label: formatDuration(Math.round(model.durationNs * ratio)),
          offset: ratio * 100,
        };
      }),
    [model.durationNs],
  );

  if (model.rows.length === 0) {
    return (
      <div className="timeline-empty">
        <strong>표시할 request가 없습니다.</strong>
        <span>event buffer가 비어 있거나 request.start가 밀려났습니다.</span>
      </div>
    );
  }

  return (
    <div className="timeline-region">
      <section className="timeline-reel" aria-label="Timeline plot">
        <div className="timeline-axis" aria-hidden="true">
          <div className="timeline-axis__labels">
            {ticks.map((tick) => (
              <span
                key={tick.offset}
                style={{ insetInlineStart: `${tick.offset}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
          <div className="timeline-axis__line">
            {ticks.map((tick) => (
              <span
                key={tick.offset}
                style={{ insetInlineStart: `${tick.offset}%` }}
              />
            ))}
          </div>
        </div>

        <div className="timeline-rows">
          {model.rows.map((row) => (
            <article className="timeline-row" key={row.id}>
              <div className="timeline-row__label">
                <strong className="truncate" title={row.label}>
                  {row.label}
                </strong>
                <span>
                  {row.status} · {formatDuration(row.durationNs)} ·{" "}
                  {row.eventCount} events
                </span>
              </div>
              <div className="timeline-row__track">
                {row.segments.map((segment) => (
                  <SegmentButton
                    key={segment.id}
                    model={model}
                    onSelect={onSelectSegment}
                    selected={selectedSegmentId === segment.id}
                    segment={segment}
                  />
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <ScreenReaderEvents model={model} />
    </div>
  );
}

function SegmentButton({
  model,
  onSelect,
  selected,
  segment,
}: {
  model: TimelineModel;
  onSelect: (id: string) => void;
  selected: boolean;
  segment: TimelineSegment;
}) {
  const style = {
    insetInlineStart: `${segmentOffset(segment, model)}%`,
    inlineSize: `${segmentWidth(segment, model)}%`,
  };
  return (
    <button
      aria-pressed={selected}
      className={[
        "timeline-segment",
        `timeline-segment--${segment.kind}`,
        segment.evidence === "inferred" ? "is-inferred" : "",
        segment.truncated ? "is-truncated" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onSelect(segment.id)}
      style={style}
      type="button"
    >
      <span aria-hidden="true">{segmentIcon(segment)}</span>
      <span className="truncate">{segment.label}</span>
      <span className="sr-only">
        {segment.kind}, {segment.evidence}, {formatDuration(segment.durationNs)}
      </span>
    </button>
  );
}

function ScreenReaderEvents({ model }: { model: TimelineModel }) {
  return (
    <ol className="sr-only" aria-label="Timeline event list">
      {model.orderedEvents.map((event) => (
        <li key={event.sequence ?? eventKey(event)}>
          {event.type} {event.label ?? ""} {event.request_id ?? "global"}
        </li>
      ))}
    </ol>
  );
}

function eventKey(event: TimelineModel["orderedEvents"][number]) {
  return [
    event.type,
    event.timestamp_ns,
    event.request_id ?? "global",
    event.span_id ?? "no-span",
    event.task_id ?? "no-task",
    event.label ?? "event",
  ].join(":");
}

function segmentIcon(segment: TimelineSegment) {
  if (segment.truncated) {
    return "…";
  }
  if (segment.kind === "waiting") {
    return "Ⅱ";
  }
  if (segment.kind === "blocking") {
    return "!";
  }
  if (segment.kind === "response") {
    return "→";
  }
  if (segment.kind === "task") {
    return "◇";
  }
  return "▶";
}
