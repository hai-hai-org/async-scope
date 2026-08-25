import {
  buildTimelineModel,
  formatDuration,
  formatTimestamp,
  type TimelineModel,
  type TimelineSegment,
} from "../../shared/api/eventStore";
import type { NormalizedEvent } from "../../shared/api/schemas";

export type { TimelineModel, TimelineSegment };
export { buildTimelineModel, formatDuration, formatTimestamp };

export function segmentOffset(segment: TimelineSegment, model: TimelineModel) {
  return percentage(segment.startNs - model.axisStartNs, model.durationNs);
}

export function segmentWidth(segment: TimelineSegment, model: TimelineModel) {
  return Math.max(0.35, percentage(segment.durationNs, model.durationNs));
}

export function eventAccessibleName(event: NormalizedEvent) {
  const request = event.request_id ? `request ${event.request_id}` : "global";
  const label = event.label ?? event.type;
  return `${event.type}, ${label}, ${request}, ${formatTimestamp(event.timestamp_ns)}`;
}

function percentage(value: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (value / total) * 100));
}
