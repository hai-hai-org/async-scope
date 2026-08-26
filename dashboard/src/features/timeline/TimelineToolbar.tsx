import type { BufferSource } from "../../shared/api/schemas";
import type { SseStatus } from "../../shared/api/sse";
import { Button, StatusBadge } from "../../shared/ui";
import type { ZoomLevel } from "./timeline";

type TimelineToolbarProps = {
  autoScroll: boolean;
  bufferSource: BufferSource;
  bufferedCount: number;
  canPan: boolean;
  canReconnect: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  eventCount: number;
  isPaused: boolean;
  onPanLeft: () => void;
  onPanRight: () => void;
  onReconnect: () => void;
  onToggleAutoScroll: () => void;
  onTogglePause: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  streamStatus: SseStatus;
  windowLabel: string;
  zoomLevel: ZoomLevel;
};

export function TimelineToolbar({
  autoScroll,
  bufferSource,
  bufferedCount,
  canPan,
  canReconnect,
  canZoomIn,
  canZoomOut,
  eventCount,
  isPaused,
  onPanLeft,
  onPanRight,
  onReconnect,
  onToggleAutoScroll,
  onTogglePause,
  onZoomIn,
  onZoomOut,
  streamStatus,
  windowLabel,
  zoomLevel,
}: TimelineToolbarProps) {
  return (
    <section className="timeline-toolbar" aria-label="Timeline controls">
      <div className="cluster">
        <Button
          aria-pressed={isPaused}
          onClick={onTogglePause}
          size="sm"
          variant={isPaused ? "primary" : "ghost"}
        >
          {isPaused ? "Resume" : "Pause"}
        </Button>
        <Button
          disabled={!canZoomOut}
          onClick={onZoomOut}
          size="sm"
          variant="ghost"
        >
          −
        </Button>
        <span className="timeline-toolbar__window">
          {windowLabel} · {zoomLevel}x
        </span>
        <Button
          disabled={!canZoomIn}
          onClick={onZoomIn}
          size="sm"
          variant="ghost"
        >
          +
        </Button>
        <Button
          disabled={!canPan}
          onClick={onPanLeft}
          size="sm"
          variant="ghost"
        >
          ←
        </Button>
        <Button
          disabled={!canPan}
          onClick={onPanRight}
          size="sm"
          variant="ghost"
        >
          →
        </Button>
        <Button
          aria-pressed={autoScroll}
          onClick={onToggleAutoScroll}
          size="sm"
          variant={autoScroll ? "primary" : "ghost"}
        >
          Auto
        </Button>
      </div>
      <div className="cluster">
        <StatusBadge
          icon={streamIcon(streamStatus)}
          tone={streamTone(streamStatus)}
        >
          {streamStatus}
        </StatusBadge>
        <StatusBadge icon={bufferSource === "live" ? "●" : "↺"} tone="inferred">
          {bufferSource}
        </StatusBadge>
        <span className="field-help">{eventCount} events</span>
        {isPaused ? (
          <StatusBadge icon="Ⅱ" tone="inferred">
            {bufferedCount} buffered
          </StatusBadge>
        ) : null}
        {canReconnect ? (
          <Button onClick={onReconnect} size="sm" variant="danger">
            Reconnect
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function streamTone(status: SseStatus) {
  if (status === "open") {
    return "success";
  }
  if (status === "gap" || status === "error" || status === "disconnected") {
    return "error";
  }
  return "inferred";
}

function streamIcon(status: SseStatus) {
  if (status === "open") {
    return "●";
  }
  if (status === "gap" || status === "error" || status === "disconnected") {
    return "!";
  }
  return "△";
}
