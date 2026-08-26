import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { SummaryState } from "../../App";
import type {
  ApiState,
  ClientStatus,
  ExportPayload,
  NormalizedEvent,
} from "../../shared/api/schemas";
import { useEventStream } from "../../shared/api/useEventStream";
import {
  Button,
  Drawer,
  EmptyState,
  MetricCard,
  Panel,
  StatusBadge,
} from "../../shared/ui";
import { useRequestDetail } from "../request-detail/useRequestDetail";
import { BlockingAlert } from "./BlockingAlert";
import { RequestInspector } from "./RequestInspector";
import { TimelinePlot } from "./TimelinePlot";
import { TimelineToolbar } from "./TimelineToolbar";
import {
  autoScrollStart,
  buildTimelineModel,
  clampViewportStart,
  createTimelineViewport,
  DEFAULT_ZOOM_INDEX,
  FIT_ALL,
  formatDuration,
  latestCursor,
  mergeTimelineEvents,
  panViewportStart,
  type TimelineSegment,
  ZOOM_WINDOWS_NS,
  type ZoomSelection,
  zoomKeepingAnchor,
} from "./timeline";

type TimelinePageProps = {
  exportState: ApiState<ExportPayload>;
  onClientStatusChange?: (status: ClientStatus | null) => void;
  onRetry?: () => void;
  summary: SummaryState;
};

export function TimelinePage({
  exportState,
  onClientStatusChange,
  onRetry,
  summary,
}: TimelinePageProps) {
  const initialEvents = payloadOf(exportState)?.events;
  // 출처를 모르는데 "live"로 단정하지 않는다. 끊긴 상태에서 거짓이 된다.
  const bufferSource = payloadOf(exportState)?.buffer.source;
  const [liveEvents, setLiveEvents] = useState<NormalizedEvent[]>([]);
  const [pendingEvents, setPendingEvents] = useState<NormalizedEvent[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  // 처음 열면 버퍼에 있는 걸 다 보여준다. 고정 1s 창으로 시작하면 트래픽이
  // 드문 앱에서 빈 화면이 뜬다. DESIGN.md는 5단계만 규정하고 초기값은 정하지
  // 않으므로, "전체를 보고 좁혀 들어간다"를 기본 동작으로 둔다.
  const [zoom, setZoom] = useState<ZoomSelection>(FIT_ALL);
  const [viewportStartNs, setViewportStartNs] = useState<number | undefined>();
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null,
  );
  const [detailOpen, setDetailOpen] = useState(false);
  const model = useMemo(() => buildTimelineModel(liveEvents), [liveEvents]);
  const viewport = useMemo(
    () => createTimelineViewport(model, zoom, viewportStartNs),
    [model, viewportStartNs, zoom],
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
    fallbackEvents: liveEvents,
    requestId: selectedRequestId,
  });
  const initialCursor = useMemo(
    () => latestCursor(initialEvents ?? []),
    [initialEvents],
  );

  useEffect(() => {
    if (initialEvents) {
      setLiveEvents(initialEvents);
      setPendingEvents([]);
      setViewportStartNs(undefined);
    }
  }, [initialEvents]);

  useEffect(() => {
    setViewportStartNs((current) =>
      autoScroll || current == null
        ? autoScrollStart(model, zoom)
        : clampViewportStart(model, zoom, current),
    );
  }, [autoScroll, model, zoom]);

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
    initialCursor,
    onEvent: handleStreamEvent,
    onGap: handleGap,
  });

  const streamStatus = stream.status;
  const clientStatus = clientStatusFromTimeline({
    hasApiError: exportState.state === "error",
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

  // 줌 단계를 옮길 때 화면상 playhead 위치를 유지한다. auto-scroll 중이면
  // 다음 effect가 최신 위치로 다시 붙이므로 굳이 계산하지 않는다.
  const applyZoom = useCallback(
    (next: ZoomSelection) => {
      setZoom(next);
      if (!autoScroll) {
        setViewportStartNs(
          zoomKeepingAnchor(model, next, model.axisEndNs, viewport),
        );
      }
    },
    [autoScroll, model, viewport],
  );

  const zoomIn = useCallback(() => {
    // 창을 좁히는 방향. fit에서 들어오면 가장 넓은 단계부터 시작한다.
    applyZoom(
      zoom === FIT_ALL ? ZOOM_WINDOWS_NS.length - 1 : Math.max(0, zoom - 1),
    );
  }, [applyZoom, zoom]);

  const zoomOut = useCallback(() => {
    if (zoom === FIT_ALL) {
      return;
    }
    applyZoom(Math.min(ZOOM_WINDOWS_NS.length - 1, zoom + 1));
  }, [applyZoom, zoom]);

  const toggleFitAll = useCallback(() => {
    applyZoom(zoom === FIT_ALL ? DEFAULT_ZOOM_INDEX : FIT_ALL);
  }, [applyZoom, zoom]);

  const panLeft = useCallback(() => {
    setAutoScroll(false);
    setViewportStartNs((current) =>
      panViewportStart(
        model,
        zoom,
        current ?? autoScrollStart(model, zoom),
        -1,
      ),
    );
  }, [model, zoom]);

  const panRight = useCallback(() => {
    setAutoScroll(false);
    setViewportStartNs((current) =>
      panViewportStart(model, zoom, current ?? autoScrollStart(model, zoom), 1),
    );
  }, [model, zoom]);

  // compact 폭에서는 drawer로 열어야 상세가 보인다.
  const selectSegment = useCallback((segmentId: string) => {
    setSelectedSegmentId(segmentId);
    setDetailOpen(true);
  }, []);

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
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        zoomOut();
      }
      if (event.key === "a" || event.key === "A") {
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
      <SummaryMetrics summary={summary} />

      <section className="timeline-layout">
        <div className="timeline-main">
          <Panel title="Request Timeline">
            <TimelineToolbar
              autoScroll={autoScroll}
              bufferSource={bufferSource}
              bufferedCount={pendingEvents.length}
              canPan={viewport.durationNs < model.durationNs}
              canReconnect={
                streamStatus === "gap" ||
                streamStatus === "error" ||
                streamStatus === "disconnected"
              }
              canZoomIn={zoom === FIT_ALL || zoom > 0}
              canZoomOut={zoom !== FIT_ALL && zoom < ZOOM_WINDOWS_NS.length - 1}
              eventCount={liveEvents.length}
              isFitAll={zoom === FIT_ALL}
              isPaused={isPaused}
              onPanLeft={panLeft}
              onPanRight={panRight}
              onReconnect={reconnect}
              onToggleAutoScroll={toggleAutoScroll}
              onToggleFitAll={toggleFitAll}
              onTogglePause={togglePause}
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              streamStatus={streamStatus}
              windowLabel={formatDuration(viewport.durationNs)}
            />
            {stream.gap ? (
              <div className="timeline-alert" role="alert">
                <strong>이어지지 않은 구간이 있습니다</strong>
                <span>
                  화면이 멈춘 동안 버퍼에서 밀려난 이벤트가 있습니다. 다시
                  연결하면 현재 버퍼를 처음부터 읽습니다.
                </span>
              </div>
            ) : null}
            <TimelineBody
              exportState={exportState}
              hasRows={model.rows.length > 0}
              onRetry={onRetry}
            >
              <TimelinePlot
                clockAnchor={summary.anchor}
                model={model}
                onSelectSegment={selectSegment}
                playheadNs={model.axisEndNs}
                selectedSegmentId={selectedSegmentId}
                viewport={viewport}
              />
              {/* 범례는 플롯을 읽는 도구다. 별 panel로 떼어 두면 인스펙터
                  자리를 빼앗고 플롯과 멀어진다. */}
              <Legend />
            </TimelineBody>
          </Panel>

          <BlockingAlert
            blockingCount={payloadOf(summary.state)?.blocking_count ?? 0}
            clockAnchor={summary.anchor}
          />
        </div>

        <div className="timeline-detail-desktop detail-aside">
          <RequestInspector
            detailState={requestDetail.state}
            onRetry={requestDetail.reload}
            selectedSegment={selectedSegment}
          />
        </div>

        <div className="timeline-detail-compact">
          <Drawer
            description={selectedSegment?.label ?? undefined}
            onOpenChange={setDetailOpen}
            open={detailOpen}
            title="요청 상세"
            trigger={
              <Button disabled={!selectedSegment} size="sm" variant="ghost">
                상세 보기
              </Button>
            }
          >
            <RequestInspector
              detailState={requestDetail.state}
              onRetry={requestDetail.reload}
              selectedSegment={selectedSegment}
            />
          </Drawer>
        </div>
      </section>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend-grid">
      {LEGEND.map((item) => (
        <div className="legend-item" key={item.label}>
          <StatusBadge icon={item.icon} tone={item.tone}>
            {item.label}
          </StatusBadge>
          <span>{item.meaning}</span>
        </div>
      ))}
    </div>
  );
}

const LEGEND = [
  {
    icon: "▶",
    label: "Running",
    meaning: "코드 실행 중",
    tone: "observed" as const,
  },
  {
    icon: "Ⅱ",
    label: "Waiting",
    meaning: "await로 대기 중이며 Event Loop는 다른 일을 합니다",
    tone: "observed" as const,
  },
  {
    icon: "!",
    label: "Blocking",
    meaning: "Event Loop가 막혀 다른 요청이 진행하지 못했습니다",
    tone: "error" as const,
  },
  {
    icon: "→",
    label: "Response",
    meaning: "응답 전송",
    tone: "success" as const,
  },
  {
    icon: "…",
    label: "Truncated",
    meaning: "화면 밖으로 이어지는 구간",
    tone: "inferred" as const,
  },
  {
    icon: "△",
    label: "추론값",
    meaning: "점선 테두리는 관찰이 아니라 추론된 구간입니다",
    tone: "inferred" as const,
  },
];

function SummaryMetrics({ summary }: { summary: SummaryState }) {
  const data = payloadOf(summary.state);
  const state = metricState(summary);

  return (
    <section className="metric-grid" aria-label="요약 지표">
      <MetricCard
        description="최근 60초 기준"
        label="요청 수"
        state={state}
        unit="req/s"
        value={formatNumber(data?.request_rate_per_second)}
      />
      <MetricCard
        description="아직 응답이 끝나지 않은 요청"
        label="활성 요청"
        state={state}
        value={data?.active_requests ?? "—"}
      />
      <MetricCard
        description={`측정 표본 ${data?.loop_delay.samples ?? 0}개`}
        label="이벤트 루프 지연 (최대)"
        state={state}
        tone={data?.loop_delay.max_ns ? "error" : "neutral"}
        value={
          data?.loop_delay.max_ns ? formatDuration(data.loop_delay.max_ns) : "—"
        }
      />
      <MetricCard
        description="임계값을 넘겨 Event Loop를 막은 구간"
        label="블로킹 감지"
        state={state}
        tone={data?.blocking_count ? "error" : "neutral"}
        unit="건"
        value={data?.blocking_count ?? "—"}
      />
      <MetricCard
        description="응답을 만든 시각"
        label="서버 시간"
        state={state}
        value={data ? formatServerTime(data.server_time) : "—"}
      />
    </section>
  );
}

function TimelineBody({
  children,
  exportState,
  hasRows,
  onRetry,
}: {
  children: ReactNode;
  exportState: ApiState<ExportPayload>;
  hasRows: boolean;
  onRetry?: () => void;
}) {
  if (exportState.state === "loading") {
    return (
      <div className="panel__state" aria-busy="true">
        <span className="skeleton" />
        <span className="skeleton" style={{ inlineSize: "72%" }} />
        <span>실행 기록을 불러오는 중입니다.</span>
      </div>
    );
  }

  if (exportState.state === "error") {
    return (
      <EmptyState
        action={
          onRetry ? (
            <Button onClick={onRetry} size="sm" variant="secondary">
              다시 시도
            </Button>
          ) : undefined
        }
        description="개발 서버가 실행 중인지 확인한 뒤 다시 시도하세요."
        title="앱과 연결되지 않았습니다"
      />
    );
  }

  if (!hasRows) {
    return (
      <EmptyState
        description="앱에 요청을 보내면 실행 흐름이 여기에 나타납니다."
        title="요청을 기다리고 있습니다"
      />
    );
  }

  return <>{children}</>;
}

function payloadOf<T>(state: ApiState<T>): T | null {
  return state.state === "ready" || state.state === "empty" ? state.data : null;
}

function metricState(summary: SummaryState) {
  if (summary.state.state === "loading") {
    return "loading";
  }
  if (summary.state.state === "error") {
    return "unavailable";
  }
  // 마지막 조회가 실패했으면 값이 남아 있어도 live라고 하지 않는다.
  if (summary.isStale) {
    return "stale";
  }
  return summary.state.state === "empty" ? "empty" : "ready";
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
  // 행 시각과 같은 24시간 표기를 쓴다. 한 화면에서 표기가 갈리면 안 된다.
  return date.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
  });
}

function findSegment(segments: TimelineSegment[], id: string) {
  return segments.find((segment) => segment.id === id) ?? null;
}

function clientStatusFromTimeline({
  hasApiError,
  isPaused,
  streamStatus,
}: {
  hasApiError: boolean;
  isPaused: boolean;
  streamStatus: string;
}): ClientStatus | null {
  if (hasApiError) {
    return "disconnected";
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
