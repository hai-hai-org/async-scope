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
  onJumpToNow: () => void;
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
  onJumpToNow,
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
        {/* 이동/현재. "지금 어디를 보고 있나"가 가장 먼저 확인하고 싶은 정보라
            첫 그룹으로 둔다. pan chip 가운데 Now를 두어 −/구간/+ chip과 같은
            "아이콘·가운데 요소·아이콘" 구조로 읽히게 한다. Now는 원샷 점프이고
            Auto(계속 따라가기, 토글)와는 다른 동작이라 버튼을 분리했다 — Auto를
            누르면 과거를 보다가도 계속-따라가기 모드에 갇히는데, 그냥 "지금이
            어디인지"만 한 번 보고 싶을 때는 그러고 싶지 않다. */}
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
            <Tooltip label="최신 구간으로 한 번 이동합니다(계속 따라가지는 않음)">
              <Button onClick={onJumpToNow} size="sm" variant="ghost">
                Now
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
          <Tooltip
            label={
              autoScroll
                ? "새 이벤트가 들어올 때마다 최신 구간을 계속 따라갑니다"
                : "꺼져 있습니다 — 다시 켜면 최신 구간으로 이동해 계속 따라갑니다"
            }
          >
            <Button
              aria-pressed={autoScroll}
              onClick={onToggleAutoScroll}
              size="sm"
              variant={autoScroll ? "primary" : "ghost"}
            >
              Auto
            </Button>
          </Tooltip>
        </div>

        {/* 줌. 예전엔 −/+ 기호를 썼는데, 가운데 표시 구간 숫자와 나란히 있으니
            "+를 누르면 이 숫자가 커져야지"라는 기대가 생겨 실제 동작(더 좁은
            구간 = 더 자세히, 숫자는 작아짐)과 어긋났다. Wider/Narrower라는
            낱말로 바꾸면 그 숫자가 아니라 "보이는 시간 범위"를 바꾼다는 게
            분명해진다. Fit all은 5단계 밖의 별도 모드라 chip 옆에 독립 버튼으로
            둔다. */}
        <div className="cluster timeline-toolbar__group">
          <div className="timeline-toolbar__chip">
            <Tooltip label="더 넓은 시간 범위를 봅니다">
              <Button
                disabled={!canZoomOut}
                onClick={onZoomOut}
                size="sm"
                variant="ghost"
              >
                Wider
              </Button>
            </Tooltip>
            <span className="timeline-toolbar__window">
              <span className="sr-only">표시 구간 </span>
              {windowLabel}
            </span>
            <Tooltip label="더 좁은(자세한) 시간 범위를 봅니다">
              <Button
                disabled={!canZoomIn}
                onClick={onZoomIn}
                size="sm"
                variant="ghost"
              >
                Narrower
              </Button>
            </Tooltip>
          </div>
          <Tooltip label="버퍼에 있는 전체 구간을 한 화면에 맞춥니다">
            <Button
              aria-pressed={isFitAll}
              onClick={onToggleFitAll}
              size="sm"
              variant={isFitAll ? "secondary" : "ghost"}
            >
              Fit all
            </Button>
          </Tooltip>
        </div>

        {/* 재생 제어. Pause/Resume을 아이콘(▶·Ⅱ)으로 바꾸는 안도 검토했지만
            그 두 글리프는 이미 아래 Legend에서 "Running"·"Waiting" segment
            상태를 가리키는 데 쓰인다 — 같은 화면에서 같은 문자가 "지금 멈춰라"와
            "이 구간은 대기 중이었다"를 동시에 뜻하게 되므로 텍스트를 유지한다.
            어디를 보고 있는지(이동)·얼마나 자세히 보는지(줌)를 먼저 정하고 나서야
            "멈출까"를 고민하는 편이라 세 그룹 중 손이 가장 덜 가는 마지막에 둔다. */}
        <div className="cluster timeline-toolbar__group">
          <Tooltip
            label={
              isPaused
                ? "재생을 다시 시작하고 그동안 모인 이벤트를 반영합니다"
                : "화면을 멈추고 새 이벤트는 버퍼에 모아둡니다"
            }
          >
            <Button
              aria-pressed={isPaused}
              onClick={onTogglePause}
              size="sm"
              variant={isPaused ? "primary" : "ghost"}
            >
              {isPaused ? "Resume" : "Pause"}
            </Button>
          </Tooltip>
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
