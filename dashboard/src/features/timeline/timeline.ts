import {
  buildFallbackRequestDetail,
  buildTimelineModel,
  formatDuration,
  formatTimestamp,
  latestCursor,
  mergeTimelineEvents,
  type TimelineModel,
  type TimelineSegment,
} from "../../shared/api/eventStore";
import type { NormalizedEvent } from "../../shared/api/schemas";

export const ZOOM_LEVELS = [0.25, 0.5, 1, 2, 4] as const;

export type ZoomLevel = (typeof ZOOM_LEVELS)[number];
export type TimelineViewport = {
  durationNs: number;
  endNs: number;
  startNs: number;
};

export type { TimelineModel, TimelineSegment };
export {
  buildFallbackRequestDetail,
  buildTimelineModel,
  formatDuration,
  formatTimestamp,
  latestCursor,
  mergeTimelineEvents,
};

export function createTimelineViewport(
  model: TimelineModel,
  zoomLevel: ZoomLevel,
  desiredStartNs?: number,
): TimelineViewport {
  const durationNs = Math.max(1, Math.round(model.durationNs / zoomLevel));
  const startNs = clampViewportStart(model, zoomLevel, desiredStartNs);
  return {
    startNs,
    endNs: startNs + durationNs,
    durationNs,
  };
}

export function autoScrollStart(model: TimelineModel, zoomLevel: ZoomLevel) {
  const durationNs = Math.max(1, Math.round(model.durationNs / zoomLevel));
  return model.axisEndNs - durationNs;
}

export function clampViewportStart(
  model: TimelineModel,
  zoomLevel: ZoomLevel,
  desiredStartNs = autoScrollStart(model, zoomLevel),
) {
  const durationNs = Math.max(1, Math.round(model.durationNs / zoomLevel));
  if (durationNs >= model.durationNs) {
    return model.axisEndNs - durationNs;
  }
  const minStart = model.axisStartNs;
  const maxStart = model.axisEndNs - durationNs;
  return Math.min(maxStart, Math.max(minStart, desiredStartNs));
}

export function panViewportStart(
  model: TimelineModel,
  zoomLevel: ZoomLevel,
  currentStartNs: number,
  direction: -1 | 1,
) {
  const durationNs = Math.max(1, Math.round(model.durationNs / zoomLevel));
  const delta = Math.max(1, Math.round(durationNs * 0.2)) * direction;
  return clampViewportStart(model, zoomLevel, currentStartNs + delta);
}

export function segmentOffset(
  segment: TimelineSegment,
  viewport: TimelineViewport,
) {
  return percentage(segment.startNs - viewport.startNs, viewport.durationNs);
}

export function segmentWidth(
  segment: TimelineSegment,
  viewport: TimelineViewport,
) {
  const startNs = Math.max(segment.startNs, viewport.startNs);
  const endNs = Math.min(segment.endNs, viewport.endNs);
  return Math.max(0.35, percentage(endNs - startNs, viewport.durationNs));
}

export function segmentIsVisible(
  segment: TimelineSegment,
  viewport: TimelineViewport,
) {
  return segment.startNs < viewport.endNs && viewport.startNs < segment.endNs;
}

export function playheadOffset(ns: number, viewport: TimelineViewport) {
  return percentage(ns - viewport.startNs, viewport.durationNs);
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
