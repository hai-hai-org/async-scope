import type { BufferSource } from "../../shared/api/schemas";
import type { SseStatus } from "../../shared/api/sse";
import { Button, StatusBadge, Tooltip } from "../../shared/ui";

type TimelineToolbarProps = {
  autoScroll: boolean;
  bufferSource?: BufferSource;
  bufferedCount: number;
  canPan: boolean;
  canReconnect: boolean;
  canZoomIn: boolean;
  canZoomOut: boolean;
  isFitAll: boolean;
  onToggleFitAll: () => void;
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
};

export function TimelineToolbar({
  autoScroll,
  bufferSource,
  bufferedCount,
  canPan,
  canReconnect,
  canZoomIn,
  canZoomOut,
  isFitAll,
  onToggleFitAll,
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
}: TimelineToolbarProps) {
  return (
    <section className="timeline-toolbar" aria-label="타임라인 조작">
      <div className="cluster">
        {/* 재생 제어. Pause/Resume을 아이콘(▶·Ⅱ)으로 바꾸는 안도 검토했지만
            그 두 글리프는 이미 아래 Legend에서 "Running"·"Waiting" segment
            상태를 가리키는 데 쓰인다 — 같은 화면에서 같은 문자가 "지금 멈춰라"와
            "이 구간은 대기 중이었다"를 동시에 뜻하게 되므로 텍스트를 유지한다. */}
        <div className="cluster timeline-toolbar__group">
          <Button
            aria-pressed={isPaused}
            onClick={onTogglePause}
            size="sm"
            variant={isPaused ? "primary" : "ghost"}
          >
            {isPaused ? "Resume" : "Pause"}
          </Button>
        </div>

        {/* 줌. −/구간/+를 하나의 표면(chip)으로 묶어 세 조각이 아니라 한
            컨트롤임을 보인다. Fit all은 5단계 밖의 별도 모드라 chip 옆에
            독립 버튼으로 둔다. */}
        <div className="cluster timeline-toolbar__group">
          <div className="timeline-toolbar__chip">
            {/* icon-only이므로 accessible name(aria-label)과 visible tooltip을
                둘 다 둔다 (DESIGN.md §8). 툴팁은 name이 아니라 description이다. */}
            <Tooltip label="시간 범위 넓히기">
              <Button
                aria-label="시간 범위 넓히기"
                className="button--icon"
                disabled={!canZoomOut}
                onClick={onZoomOut}
                size="sm"
                variant="ghost"
              >
                −
              </Button>
            </Tooltip>
            <span className="timeline-toolbar__window">
              <span className="sr-only">표시 구간 </span>
              {windowLabel}
            </span>
            <Tooltip label="시간 범위 좁히기">
              <Button
                aria-label="시간 범위 좁히기"
                className="button--icon"
                disabled={!canZoomIn}
                onClick={onZoomIn}
                size="sm"
                variant="ghost"
              >
                +
              </Button>
            </Tooltip>
          </div>
          <Button
            aria-pressed={isFitAll}
            onClick={onToggleFitAll}
            size="sm"
            variant={isFitAll ? "secondary" : "ghost"}
          >
            Fit all
          </Button>
        </div>

        {/* 이동. 과거/최신으로 한 칸씩 옮기는 pan과, 최신을 계속 따라갈지
            정하는 Auto는 같은 축(지금 뭘 보고 있는가)이라 한 그룹으로 묶는다. */}
        <div className="cluster timeline-toolbar__group">
          <div className="timeline-toolbar__chip">
            <Tooltip label="이전 구간 보기">
              <Button
                aria-label="이전 구간 보기"
                className="button--icon"
                disabled={!canPan}
                onClick={onPanLeft}
                size="sm"
                variant="ghost"
              >
                ←
              </Button>
            </Tooltip>
            <Tooltip label="다음 구간 보기">
              <Button
                aria-label="다음 구간 보기"
                className="button--icon"
                disabled={!canPan}
                onClick={onPanRight}
                size="sm"
                variant="ghost"
              >
                →
              </Button>
            </Tooltip>
          </div>
          <Button
            aria-pressed={autoScroll}
            onClick={onToggleAutoScroll}
            size="sm"
            variant={autoScroll ? "primary" : "ghost"}
          >
            Auto
          </Button>
        </div>
      </div>
      <div className="cluster">
        <StatusBadge
          icon={streamIcon(streamStatus)}
          tone={streamTone(streamStatus)}
        >
          {streamStatus}
        </StatusBadge>
        {/* stream 상태 배지와 나란히 "live"를 또 띄우면 같은 말을 두 번 한다.
            replay/mixed처럼 예외일 때만 알린다. */}
        {bufferSource && bufferSource !== "live" ? (
          <StatusBadge icon="↺" tone="inferred">
            {bufferSource}
          </StatusBadge>
        ) : null}
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
