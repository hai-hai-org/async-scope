import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SummaryState } from "../../App";
import type {
  ApiState,
  ClientStatus,
  ExportPayload,
  NormalizedEvent,
} from "../../shared/api/schemas";
import type { SseGapPayload } from "../../shared/api/sse";
import { useEventStream } from "../../shared/api/useEventStream";
import {
  Button,
  EmptyState,
  MetricCard,
  Panel,
  StatusBadge,
  Tooltip,
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
  defaultZoomFor,
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
  // 부트스트랩 값일 뿐이다. 실제 기본 줌은 데이터가 처음 도착했을 때
  // defaultZoomFor로 한 번 계산해 아래 effect가 덮어쓴다(row가 없는 동안엔
  // TimelinePlot이 empty-state를 먼저 그리므로 이 값이 화면에 보이지 않는다).
  const [zoom, setZoom] = useState<ZoomSelection>(FIT_ALL);
  const [viewportStartNs, setViewportStartNs] = useState<number | undefined>();
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null,
  );
  // 기본 줌은 데이터가 처음 채워질 때 한 번만 정한다. 스트림이 계속 들어와
  // model이 자라거나 사용자가 직접 줌을 조작한 뒤에는 다시 끼어들지 않는다.
  const hasAppliedDefaultZoomRef = useRef(false);
  const userAdjustedZoomRef = useRef(false);
  // initialEvents가 아직 도착하기 전에 SSE가 낱개 이벤트를 먼저 흘려보내면
  // model.rows가 잠깐 1개짜리로 채워진다. 그 순간을 "처음 채워진 데이터"로
  // 오인해 defaultZoomFor를 계산하면, 뒤이어 진짜 initialEvents(버퍼 전체)가
  // 도착해도 이미 잠긴 좁은 줌이 남는다 — 실측: 5분 넘게 퍼진 요청들인데
  // 250ms 창에 갇혀 세그먼트가 하나도 안 보였다. initialEvents의 결론(있든
  // 없든)이 나기 전까지는 이 fallback을 막는다.
  const initialEventsResolvedRef = useRef(false);
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
      // initialEvents가 곧 "처음 채워진 데이터"의 권위 있는 스냅샷이다.
      // 여기서 바로 계산하면 아래 fallback effect의 경쟁 상태를 피한다.
      if (!hasAppliedDefaultZoomRef.current && !userAdjustedZoomRef.current) {
        const initialModel = buildTimelineModel(initialEvents);
        if (initialModel.rows.length > 0) {
          hasAppliedDefaultZoomRef.current = true;
          setZoom(defaultZoomFor(initialModel));
        }
      }
    }
    // "loading" 동안엔 아직 아무것도 결론나지 않은 것이다 — 이 시점에
    // resolved로 표시하면 fallback effect가 곧바로 풀려 버려서 gate가
    // 무력해진다("loading" → "ready"로 넘어가기 전 첫 렌더에서 effect는
    // initialEvents 값과 무관하게 한 번 실행되기 때문이다).
    if (exportState.state !== "loading") {
      initialEventsResolvedRef.current = true;
    }
  }, [exportState.state, initialEvents]);

  useEffect(() => {
    setViewportStartNs((current) =>
      autoScroll || current == null
        ? autoScrollStart(model, zoom)
        : clampViewportStart(model, zoom, current),
    );
  }, [autoScroll, model, zoom]);

  // initialEvents가 끝내 비어 있었던 경우의 fallback이다 — 그때는 위
  // initialEvents effect가 계산할 데이터가 없으므로, 첫 실시간 이벤트가
  // 도착해 row가 처음 생기는 순간 대신 계산한다. initialEvents의 결론이
  // 나기 전에는(=아직 무엇으로도 판단할 수 없는 사이) 절대 먼저 끼어들지
  // 않는다 — 그 경쟁이 바로 위 effect에 남긴 주석의 실측 버그였다.
  useEffect(() => {
    if (hasAppliedDefaultZoomRef.current || userAdjustedZoomRef.current) {
      return;
    }
    if (!initialEventsResolvedRef.current) {
      return;
    }
    if (model.rows.length === 0) {
      return;
    }
    hasAppliedDefaultZoomRef.current = true;
    setZoom(defaultZoomFor(model));
  }, [model]);

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

  const handleGap = useCallback((gap: SseGapPayload) => {
    setLiveEvents([]);
    setPendingEvents([]);
    setSelectedSegmentId(null);
    // 버퍼가 통째로 비었으면(사용자가 방금 비웠거나 대상 앱이 재시작한 경우)
    // 놓친 걸 알려줄 게 없다 — 아래 effect가 조용히 다시 붙이므로 auto-scroll을
    // 끌 필요가 없다. ring buffer가 오래된 이벤트만 밀어낸 진짜 gap만 사용자가
    // 판단하도록 멈춘다.
    if (!isBufferClearedGap(gap)) {
      setAutoScroll(false);
    }
  }, []);

  const stream = useEventStream({
    initialCursor,
    onEvent: handleStreamEvent,
    onGap: handleGap,
  });

  // 버퍼가 비어 생긴 gap은 사용자 판단이 필요 없다 — cursor 없이 바로 다시
  // 이어붙인다. reconnect가 gap을 지우므로 한 번 실행되면 조건이 다시
  // 참이 되지 않는다(무한 루프 아님).
  useEffect(() => {
    if (stream.gap && isBufferClearedGap(stream.gap)) {
      stream.reconnect(null);
    }
  }, [stream.gap, stream.reconnect]);

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
      // 사용자가 직접 줌을 골랐다 — 데이터 기반 기본값 effect는 이제 다시
      // 끼어들지 않는다.
      userAdjustedZoomRef.current = true;
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

  // Auto 토글과 다르다 — 계속 따라가기로 전환하지 않고 지금 한 번만 최신
  // 구간으로 옮긴다. 과거를 살펴보다 방향을 잃었을 때 auto-follow에
  // 갇히지 않고 그냥 "지금이 어디인지"만 확인하고 싶은 경우를 위한 것이다.
  const jumpToNow = useCallback(() => {
    setViewportStartNs(autoScrollStart(model, zoom));
  }, [model, zoom]);

  const selectSegment = useCallback((segmentId: string) => {
    setSelectedSegmentId(segmentId);
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
      if (event.key === "0") {
        event.preventDefault();
        jumpToNow();
      }
      // 세그먼트 안에서는 화살표가 구간 이동을 담당한다 (roving tabindex).
      // 여기서 viewport를 함께 움직이면 둘이 싸운다.
      if (isInsideSegments(event.target)) {
        return;
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
  }, [
    jumpToNow,
    panLeft,
    panRight,
    toggleAutoScroll,
    togglePause,
    zoomIn,
    zoomOut,
  ]);

  return (
    <div className="dashboard-page">
      <SummaryMetrics summary={summary} />

      <section className="timeline-layout">
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
            onJumpToNow={jumpToNow}
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
          {/* 버퍼가 비어 생긴 gap은 위 effect가 조용히 다시 붙이므로 사용자에게
              보여줄 필요가 없다 — 진짜로 이벤트가 밀려난 경우만 알린다. */}
          {stream.gap && !isBufferClearedGap(stream.gap) ? (
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

        {/* Timeline이 전체 폭을 쓰도록 그 아래로 내렸다. 알림(무엇이 막혔고
            어떻게 고치는가)과 상세(지금 고른 구간)는 서로 다른 질문에
            답하므로 위아래로 쌓지 않고 나란히 둔다. */}
        <div className="timeline-bottom-row">
          <div className="detail-aside">
            <RequestInspector
              detailState={requestDetail.state}
              onRetry={requestDetail.reload}
              selectedSegment={selectedSegment}
            />
          </div>

          <BlockingAlert
            blockingCount={payloadOf(summary.state)?.blocking_count ?? 0}
            clockAnchor={summary.anchor}
          />
        </div>
      </section>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend-grid">
      {LEGEND.map((item) => (
        <Tooltip key={item.label} label={item.meaning} side="top">
          <StatusBadge focusable icon={item.icon} tone={item.tone}>
            {item.label}
          </StatusBadge>
        </Tooltip>
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
    // "inferred"는 점선 테두리(evidence 신호) 전용이다 — truncated는 추론이
    // 아니라 그냥 화면 밖으로 잘린 것이라 같은 톤을 쓰면 안 된다.
    tone: "neutral" as const,
  },
  {
    icon: "△",
    label: "Inferred",
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

/**
 * ring buffer가 오래된 이벤트만 밀어낸 gap은 first/last_sequence가 남는다.
 * 버퍼가 통째로 비어 둘 다 없으면(사용자가 비웠거나 대상 앱이 재시작한 경우)
 * "무엇을 놓쳤는지" 알려줄 게 없다 — 그게 이 둘을 구분하는 유일한 신호다.
 */
function isBufferClearedGap(gap: SseGapPayload) {
  return gap.first_sequence == null && gap.last_sequence == null;
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

/** 포커스가 타임라인 구간 목록 안에 있는가. */
function isInsideSegments(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest(".timeline-segment"));
}

function isButtonLike(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(target.closest("button, a"));
}
