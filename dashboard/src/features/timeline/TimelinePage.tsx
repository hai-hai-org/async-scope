import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  BufferSource,
  ClientStatus,
  NormalizedEvent,
} from "../../shared/api/schemas";
import type { SseStatus } from "../../shared/api/sse";
import { useEventStream } from "../../shared/api/useEventStream";
import { Button, Panel, StatusBadge } from "../../shared/ui";
import { eventFixtures } from "../../test/fixtures";
import { useRequestDetail } from "../request-detail/useRequestDetail";
import { RequestInspector } from "./RequestInspector";
import { TimelinePlot } from "./TimelinePlot";
import { TimelineToolbar } from "./TimelineToolbar";
import {
  autoScrollStart,
  buildTimelineModel,
  clampViewportStart,
  createTimelineViewport,
  formatDuration,
  latestCursor,
  mergeTimelineEvents,
  panViewportStart,
  type TimelineSegment,
  ZOOM_LEVELS,
} from "./timeline";

type FixtureKey = keyof typeof eventFixtures;

const fixtureLabels: Record<FixtureKey, string> = {
  timeline: "two sleep requests",
  blocking: "blocking",
  unknownAwait: "unknown await",
  adapterAwaits: "adapter awaits",
  failureCancel: "failure/cancel",
  disconnect: "disconnect",
  backgroundTask: "background task",
};

type TimelinePageProps = {
  bufferSource: BufferSource;
  events?: NormalizedEvent[];
  onClientStatusChange?: (status: ClientStatus | null) => void;
};

export function TimelinePage({
  bufferSource,
  events,
  onClientStatusChange,
}: TimelinePageProps) {
  const [fixtureKey, setFixtureKey] = useState<FixtureKey>("timeline");
  const [liveEvents, setLiveEvents] = useState<NormalizedEvent[]>(events ?? []);
  const [pendingEvents, setPendingEvents] = useState<NormalizedEvent[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [viewportStartNs, setViewportStartNs] = useState<number | undefined>();
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null,
  );
  const isFixtureMode = events === undefined;
  const sourceEvents = isFixtureMode ? eventFixtures[fixtureKey] : liveEvents;
  const zoomLevel = ZOOM_LEVELS[zoomIndex];
  const model = useMemo(() => buildTimelineModel(sourceEvents), [sourceEvents]);
  const viewport = useMemo(
    () => createTimelineViewport(model, zoomLevel, viewportStartNs),
    [model, viewportStartNs, zoomLevel],
  );
  const selectedSegment = selectedSegmentId
    ? findSegment(
        model.rows.flatMap((row) => row.segments),
        selectedSegmentId,
      )
    : null;
  const selectedRequestId =
    selectedSegment && selectedSegment.rowId !== "__tasks"
      ? selectedSegment.rowId
      : null;
  const requestDetail = useRequestDetail({
    fallbackEvents: sourceEvents,
    fetchEnabled: !isFixtureMode,
    requestId: selectedRequestId,
  });
  const initialCursor = useMemo(() => latestCursor(events ?? []), [events]);

  useEffect(() => {
    if (events) {
      setLiveEvents(events);
      setPendingEvents([]);
      setViewportStartNs(undefined);
    }
  }, [events]);

  useEffect(() => {
    setViewportStartNs((current) =>
      autoScroll || current == null
        ? autoScrollStart(model, zoomLevel)
        : clampViewportStart(model, zoomLevel, current),
    );
  }, [autoScroll, model, zoomLevel]);

  const handleStreamEvent = useCallback(
    (event: NormalizedEvent) => {
      if (isPaused) {
        setPendingEvents((current) => mergeTimelineEvents(current, [event]));
        return;
      }
      setLiveEvents((current) => mergeTimelineEvents(current, [event]));
    },
    [isPaused],
  );

  const handleGap = useCallback(() => {
    setLiveEvents([]);
    setPendingEvents([]);
    setSelectedSegmentId(null);
    setAutoScroll(false);
  }, []);

  const stream = useEventStream({
    enabled: !isFixtureMode,
    initialCursor,
    onEvent: handleStreamEvent,
    onGap: handleGap,
  });

  const streamStatus: SseStatus = isFixtureMode ? "idle" : stream.status;
  const clientStatus = clientStatusFromTimeline({
    isFixtureMode,
    isPaused,
    streamStatus,
  });

  useEffect(() => {
    onClientStatusChange?.(clientStatus);
  }, [clientStatus, onClientStatusChange]);

  useEffect(
    () => () => {
      onClientStatusChange?.(null);
    },
    [onClientStatusChange],
  );

  useEffect(() => {
    if (selectedSegmentId && !selectedSegment) {
      setSelectedSegmentId(null);
    }
  }, [selectedSegment, selectedSegmentId]);

  const togglePause = useCallback(() => {
    setIsPaused((paused) => {
      if (paused) {
        setLiveEvents((current) => mergeTimelineEvents(current, pendingEvents));
        setPendingEvents([]);
        if (autoScroll) {
          setViewportStartNs(undefined);
        }
        return false;
      }
      return true;
    });
  }, [autoScroll, pendingEvents]);

  const zoomIn = useCallback(() => {
    setZoomIndex((index) => Math.min(ZOOM_LEVELS.length - 1, index + 1));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomIndex((index) => Math.max(0, index - 1));
  }, []);

  const panLeft = useCallback(() => {
    setAutoScroll(false);
    setViewportStartNs((current) =>
      panViewportStart(
        model,
        zoomLevel,
        current ?? autoScrollStart(model, zoomLevel),
        -1,
      ),
    );
  }, [model, zoomLevel]);

  const panRight = useCallback(() => {
    setAutoScroll(false);
    setViewportStartNs((current) =>
      panViewportStart(
        model,
        zoomLevel,
        current ?? autoScrollStart(model, zoomLevel),
        1,
      ),
    );
  }, [model, zoomLevel]);

  const toggleAutoScroll = useCallback(() => {
    setAutoScroll((current) => !current);
  }, []);

  const reconnect = useCallback(() => {
    setLiveEvents([]);
    setPendingEvents([]);
    setSelectedSegmentId(null);
    setAutoScroll(true);
    stream.reconnect(null);
  }, [stream]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntry(event.target)) {
        return;
      }
      if (event.key === " " && !isButtonLike(event.target)) {
        event.preventDefault();
        togglePause();
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomIn();
      }
      if (event.key === "-") {
        event.preventDefault();
        zoomOut();
      }
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        toggleAutoScroll();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        panLeft();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        panRight();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panLeft, panRight, toggleAutoScroll, togglePause, zoomIn, zoomOut]);

  return (
    <div className="dashboard-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Day15+16 · Issue #63</p>
          <h2>Timeline controls와 RequestInspector</h2>
          <p>
            live stream을 잃지 않고 pause·zoom·pan으로 탐색하며, 선택한
            request의 metadata와 시간 분포를 같은 event buffer에서 설명한다.
          </p>
        </div>
        <div className="cluster">
          {isFixtureMode ? (
            (Object.keys(eventFixtures) as FixtureKey[]).map((key) => (
              <Button
                className={fixtureKey === key ? "is-focus" : undefined}
                key={key}
                onClick={() => {
                  setFixtureKey(key);
                  setSelectedSegmentId(null);
                }}
                size="sm"
                variant={fixtureKey === key ? "primary" : "ghost"}
              >
                {fixtureLabels[key]}
              </Button>
            ))
          ) : (
            <StatusBadge icon="●" tone="observed">
              export data
            </StatusBadge>
          )}
        </div>
      </section>

      <Panel
        actions={
          <StatusBadge icon="△" tone="inferred">
            inferred uses dashed border
          </StatusBadge>
        }
        description="색상 없이도 icon, label, border style로 상태와 근거를 구분한다."
        title="Timeline"
      >
        <TimelineToolbar
          autoScroll={autoScroll}
          bufferSource={bufferSource}
          bufferedCount={pendingEvents.length}
          canPan={viewport.durationNs < model.durationNs}
          canReconnect={
            !isFixtureMode &&
            (streamStatus === "gap" ||
              streamStatus === "error" ||
              streamStatus === "disconnected")
          }
          canZoomIn={zoomIndex < ZOOM_LEVELS.length - 1}
          canZoomOut={zoomIndex > 0}
          eventCount={sourceEvents.length}
          isPaused={isPaused}
          onPanLeft={panLeft}
          onPanRight={panRight}
          onReconnect={reconnect}
          onToggleAutoScroll={toggleAutoScroll}
          onTogglePause={togglePause}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          streamStatus={streamStatus}
          windowLabel={formatDuration(viewport.durationNs)}
          zoomLevel={zoomLevel}
        />
        {stream.gap ? (
          <div className="timeline-alert" role="alert">
            <strong>event gap</strong>
            <span>
              cursor {stream.gap.cursor ?? "none"} 이후 stream을 이어 받을 수
              없다. Reconnect는 cursor 없이 현재 buffer를 다시 읽는다.
            </span>
          </div>
        ) : null}
        <TimelinePlot
          model={model}
          onSelectSegment={setSelectedSegmentId}
          playheadNs={model.axisEndNs}
          selectedSegmentId={selectedSegmentId}
          viewport={viewport}
        />
      </Panel>

      <section className="grid grid--two">
        <RequestInspector
          detailState={requestDetail.state}
          onRetry={requestDetail.reload}
          selectedSegment={selectedSegment}
        />
        <Panel
          description="Timeline state vocabulary를 고정한다."
          title="Legend"
        >
          <div className="legend-grid">
            <StatusBadge icon="▶" tone="observed">
              running
            </StatusBadge>
            <StatusBadge icon="Ⅱ" tone="observed">
              waiting
            </StatusBadge>
            <StatusBadge icon="!" tone="error">
              blocking
            </StatusBadge>
            <StatusBadge icon="→" tone="success">
              response
            </StatusBadge>
            <StatusBadge icon="…" tone="inferred">
              truncated
            </StatusBadge>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function findSegment(segments: TimelineSegment[], id: string) {
  return segments.find((segment) => segment.id === id) ?? null;
}

function clientStatusFromTimeline({
  isFixtureMode,
  isPaused,
  streamStatus,
}: {
  isFixtureMode: boolean;
  isPaused: boolean;
  streamStatus: SseStatus;
}): ClientStatus | null {
  if (isFixtureMode) {
    return null;
  }
  if (isPaused) {
    return "paused";
  }
  if (
    streamStatus === "disconnected" ||
    streamStatus === "gap" ||
    streamStatus === "error"
  ) {
    return "disconnected";
  }
  return "running";
}

function isTextEntry(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("input, textarea, select, [contenteditable]"));
}

function isButtonLike(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("button, a"));
}
