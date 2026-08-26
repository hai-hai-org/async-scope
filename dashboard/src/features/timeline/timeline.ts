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

/**
 * DESIGN.md §4: 정해진 5단계만 이동한다. 값은 "전체 구간의 배수"가 아니라
 * 보이는 창의 폭(ns)이다. 배수를 쓰면 데이터 길이에 따라 창이 변해서
 * "1s 창"이라는 개념 자체가 성립하지 않는다.
 */
export const ZOOM_WINDOWS_NS = [
  250_000_000, 500_000_000, 1_000_000_000, 2_000_000_000, 5_000_000_000,
] as const;

export const DEFAULT_ZOOM_INDEX = 2; // 1s

/**
 * 줌 단계 하나가 아니라 별개 모드다. 스펙이 5단계로 못박았으므로 배열에 넣지 않고
 * "버퍼에 있는 전 구간을 한 화면에" 라는 의도를 따로 표현한다.
 */
export const FIT_ALL = "fit" as const;
export type ZoomSelection = number | typeof FIT_ALL;

export type TimelineViewport = {
  durationNs: number;
  endNs: number;
  startNs: number;
};

/** 선택된 줌이 실제로 만드는 창의 폭. 데이터가 창보다 짧으면 전 구간으로 줄인다. */
export function windowNsFor(model: TimelineModel, zoom: ZoomSelection): number {
  const span = Math.max(1, model.durationNs);
  if (zoom === FIT_ALL) {
    return span;
  }
  const requested =
    ZOOM_WINDOWS_NS[zoom] ?? ZOOM_WINDOWS_NS[DEFAULT_ZOOM_INDEX];
  // 데이터보다 넓은 창은 빈 공간만 보여 준다. 있는 만큼만 보여 준다.
  return Math.min(requested, span);
}

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
  zoom: ZoomSelection,
  desiredStartNs?: number,
): TimelineViewport {
  const durationNs = windowNsFor(model, zoom);
  const startNs = clampViewportStart(model, zoom, desiredStartNs);
  return {
    startNs,
    endNs: startNs + durationNs,
    durationNs,
  };
}

export function autoScrollStart(model: TimelineModel, zoom: ZoomSelection) {
  return model.axisEndNs - windowNsFor(model, zoom);
}

export function clampViewportStart(
  model: TimelineModel,
  zoom: ZoomSelection,
  desiredStartNs = autoScrollStart(model, zoom),
) {
  const durationNs = windowNsFor(model, zoom);
  const minStart = model.axisStartNs;
  const maxStart = model.axisEndNs - durationNs;
  if (maxStart <= minStart) {
    return minStart;
  }
  return Math.min(maxStart, Math.max(minStart, desiredStartNs));
}

export function panViewportStart(
  model: TimelineModel,
  zoom: ZoomSelection,
  currentStartNs: number,
  direction: -1 | 1,
) {
  const durationNs = windowNsFor(model, zoom);
  const delta = Math.max(1, Math.round(durationNs * 0.2)) * direction;
  return clampViewportStart(model, zoom, currentStartNs + delta);
}

/**
 * 줌을 바꿀 때 화면상 anchor(playhead) 위치를 유지한다.
 * DESIGN.md §6: "cursor 또는 선택 playhead를 zoom anchor로 유지한다".
 */
export function zoomKeepingAnchor(
  model: TimelineModel,
  nextZoom: ZoomSelection,
  anchorNs: number,
  currentViewport: TimelineViewport,
): number {
  const ratio =
    currentViewport.durationNs > 0
      ? (anchorNs - currentViewport.startNs) / currentViewport.durationNs
      : 1;
  const nextWindow = windowNsFor(model, nextZoom);
  return clampViewportStart(model, nextZoom, anchorNs - nextWindow * ratio);
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
