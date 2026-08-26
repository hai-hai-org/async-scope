import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { type ClockAnchor, formatWallClock } from "../../shared/api/eventStore";
import type {
  TimelineModel,
  TimelineSegment,
  TimelineViewport,
} from "./timeline";
import {
  formatDuration,
  playheadOffset,
  segmentIsVisible,
  segmentOffset,
  segmentWidth,
} from "./timeline";

type TimelinePlotProps = {
  clockAnchor: ClockAnchor | null;
  model: TimelineModel;
  onSelectSegment: (id: string) => void;
  playheadNs: number;
  selectedSegmentId: string | null;
  viewport: TimelineViewport;
};

const TICK_COUNT = 5;

export function TimelinePlot({
  clockAnchor,
  model,
  onSelectSegment,
  playheadNs,
  selectedSegmentId,
  viewport,
}: TimelinePlotProps) {
  const timelineHelpId = useId();
  const ticks = useMemo(
    () =>
      Array.from({ length: TICK_COUNT }, (_, index) => {
        const ratio = index / (TICK_COUNT - 1);
        const relativeNs = Math.round(
          viewport.startNs + viewport.durationNs * ratio - model.axisStartNs,
        );
        return {
          label:
            relativeNs < 0
              ? `-${formatDuration(Math.abs(relativeNs))}`
              : formatDuration(relativeNs),
          offset: ratio * 100,
        };
      }),
    [model.axisStartNs, viewport.durationNs, viewport.startNs],
  );
  const playhead = playheadOffset(playheadNs, viewport);
  const showPlayhead = playhead >= 0 && playhead <= 100;
  // roving tabindex 좌표를 만들기 위해 가시 세그먼트를 행 단위로 미리 나눈다.
  const visibleRows = useMemo(
    () =>
      model.rows.map((row) => ({
        row,
        segments: row.segments.filter((segment) =>
          segmentIsVisible(segment, viewport),
        ),
      })),
    [model.rows, viewport],
  );
  const roving = useRovingSegments(visibleRows, selectedSegmentId);

  if (model.rows.length === 0) {
    return (
      <div className="timeline-empty">
        <strong>표시할 요청이 없습니다</strong>
        <span>
          버퍼가 비었거나, 오래된 이벤트가 밀려나 시작 지점이 남아 있지
          않습니다.
        </span>
      </div>
    );
  }

  return (
    <div className="timeline-region">
      <section
        aria-describedby={timelineHelpId}
        aria-label="실행 타임라인"
        className="timeline-reel"
      >
        <div className="timeline-axis">
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
            {showPlayhead ? (
              <span
                aria-label="현재 시각 표시선"
                aria-valuetext={formatWallClock(playheadNs, clockAnchor)}
                className="timeline-playhead"
                role="slider"
                aria-valuenow={Math.round(playhead)}
                aria-valuemin={0}
                aria-valuemax={100}
                style={{ insetInlineStart: `${playhead}%` }}
                tabIndex={0}
              />
            ) : null}
          </div>
        </div>

        {/* 세그먼트 전체가 하나의 composite widget이다. Tab 정지는 1개이고
            안에서는 화살표로 이동한다. grid role은 스크린리더가 행·열 좌표를
            읽어 시끄러워지므로 쓰지 않는다. */}
        <div
          className="timeline-rows"
          onKeyDown={roving.onKeyDown}
          role="toolbar"
          aria-label="실행 구간"
          aria-orientation="horizontal"
        >
          {visibleRows.map(({ row, segments }, rowIndex) => (
            <article
              aria-label={`${row.label}, ${row.status}, ${formatDuration(
                row.durationNs,
              )}, ${row.eventCount} events`}
              className="timeline-row"
              key={row.id}
            >
              <div className="timeline-row__label">
                <span className="timeline-row__start">
                  {formatWallClock(row.startNs, clockAnchor)}
                </span>
                <span className="timeline-row__request">
                  <span className="timeline-row__method">{row.method}</span>
                  <span className="truncate" title={row.path || row.label}>
                    {row.path || row.label}
                  </span>
                </span>
              </div>
              <div className="timeline-row__track">
                {segments.map((segment, columnIndex) => (
                  <SegmentButton
                    active={
                      roving.active.row === rowIndex &&
                      roving.active.column === columnIndex
                    }
                    key={segment.id}
                    onSelect={onSelectSegment}
                    registerRef={roving.registerRef}
                    rowIndex={rowIndex}
                    columnIndex={columnIndex}
                    selected={selectedSegmentId === segment.id}
                    segment={segment}
                    viewport={viewport}
                  />
                ))}
                {showPlayhead ? (
                  <span
                    aria-hidden="true"
                    className="timeline-row__playhead"
                    style={{ insetInlineStart: `${playhead}%` }}
                  />
                ) : null}
              </div>
              <span className="timeline-row__total">
                {formatDuration(row.durationNs)}
              </span>
            </article>
          ))}
        </div>
      </section>

      <p className="sr-only" id={timelineHelpId}>
        타임라인은 가로로 스크롤할 수 있습니다. Tab으로 구간 목록에 들어간 뒤
        좌우 화살표로 같은 요청의 구간을, 위아래 화살표로 다른 요청을
        이동합니다. Home과 End는 행의 처음과 끝으로 갑니다. Enter 또는 Space로
        선택합니다.
      </p>
      <ScreenReaderEvents model={model} />
    </div>
  );
}

type VisibleRow = {
  row: TimelineModel["rows"][number];
  segments: TimelineSegment[];
};

/**
 * 세그먼트 집합을 하나의 composite widget으로 다룬다 (roving tabindex).
 * 세그먼트가 각자 Tab 정지를 가지면 요청이 많을 때 타임라인을 지나가는 데
 * Tab을 수십 번 눌러야 한다 (실측 64개).
 */
function useRovingSegments(
  visibleRows: VisibleRow[],
  selectedSegmentId: string | null,
) {
  const [active, setActive] = useState({ row: 0, column: 0 });
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const key = (r: number, c: number) => `${r}:${c}`;

  const registerRef = useCallback(
    (r: number, c: number, node: HTMLButtonElement | null) => {
      if (node) {
        refs.current.set(key(r, c), node);
      } else {
        refs.current.delete(key(r, c));
      }
    },
    [],
  );

  // 선택된 세그먼트가 있으면 그것이 활성이다. 데이터가 바뀌어 좌표가
  // 사라졌으면 범위 안으로 되돌린다.
  useEffect(() => {
    if (selectedSegmentId) {
      for (const [rowIndex, entry] of visibleRows.entries()) {
        const column = entry.segments.findIndex(
          (segment) => segment.id === selectedSegmentId,
        );
        if (column >= 0) {
          setActive({ row: rowIndex, column });
          return;
        }
      }
    }
    setActive((current) => {
      const rowCount = visibleRows.length;
      if (!rowCount) {
        return { row: 0, column: 0 };
      }
      let row = Math.min(current.row, rowCount - 1);
      // 활성 좌표가 가시 세그먼트 없는 행을 가리키면 그 행에는 tabIndex 0이
      // 붙을 대상이 없어 타임라인 전체가 Tab 정지를 잃는다. 줌을 좁히면
      // 흔히 생기는 상황이므로 세그먼트가 있는 행으로 옮긴다.
      if ((visibleRows[row]?.segments.length ?? 0) === 0) {
        const withSegments = visibleRows.findIndex(
          (entry) => entry.segments.length > 0,
        );
        if (withSegments < 0) {
          return current;
        }
        row = withSegments;
      }
      const columns = visibleRows[row]?.segments.length ?? 0;
      const column = Math.min(current.column, Math.max(0, columns - 1));
      return row === current.row && column === current.column
        ? current
        : { row, column };
    });
  }, [selectedSegmentId, visibleRows]);

  const move = useCallback((row: number, column: number) => {
    setActive({ row, column });
    // 실제 포커스를 옮겨야 스크린리더와 :focus-visible이 따라온다.
    refs.current.get(`${row}:${column}`)?.focus();
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const rowCount = visibleRows.length;
      if (!rowCount) {
        return;
      }
      // 세그먼트에 포커스가 있을 때만 다룬다. 트랙 여백을 눌러도 반응하면
      // 전역 단축키와 헷갈린다.
      if (!(event.target as HTMLElement).closest(".timeline-segment")) {
        return;
      }
      const { row, column } = active;
      const columns = visibleRows[row]?.segments.length ?? 0;
      const nextRow = (delta: number) => {
        // 세그먼트가 없는 행은 건너뛴다.
        for (let i = 1; i <= rowCount; i += 1) {
          const candidate = (row + delta * i + rowCount * i) % rowCount;
          if ((visibleRows[candidate]?.segments.length ?? 0) > 0) {
            return candidate;
          }
        }
        return row;
      };

      // 다루는 키는 경계에서도 전파를 막는다. 그냥 return하면 행의 끝에서
      // 이벤트가 전역 핸들러로 올라가 viewport가 함께 움직인다.
      const handled = [
        "ArrowRight",
        "ArrowLeft",
        "ArrowUp",
        "ArrowDown",
        "Home",
        "End",
      ];
      if (handled.includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
      }

      switch (event.key) {
        case "ArrowRight":
          if (column < columns - 1) {
            move(row, column + 1);
          }
          return;
        case "ArrowLeft":
          if (column > 0) {
            move(row, column - 1);
          }
          return;
        case "ArrowDown": {
          const target = nextRow(1);
          move(
            target,
            Math.min(column, (visibleRows[target]?.segments.length ?? 1) - 1),
          );
          return;
        }
        case "ArrowUp": {
          const target = nextRow(-1);
          move(
            target,
            Math.min(column, (visibleRows[target]?.segments.length ?? 1) - 1),
          );
          return;
        }
        case "Home":
          move(row, 0);
          return;
        case "End":
          move(row, Math.max(0, columns - 1));
          return;
        default:
      }
    },
    [active, move, visibleRows],
  );

  return { active, onKeyDown, registerRef };
}

function SegmentButton({
  active,
  columnIndex,
  onSelect,
  registerRef,
  rowIndex,
  selected,
  segment,
  viewport,
}: {
  active: boolean;
  columnIndex: number;
  onSelect: (id: string) => void;
  registerRef: (
    rowIndex: number,
    columnIndex: number,
    node: HTMLButtonElement | null,
  ) => void;
  rowIndex: number;
  selected: boolean;
  segment: TimelineSegment;
  viewport: TimelineViewport;
}) {
  const offset = segmentOffset(segment, viewport);
  const width = segmentWidth(segment, viewport);
  // 트랙 오른쪽 끝에 붙는 세그먼트는 CSS의 min-inline-size(18px, 클릭 가능한
  // 최소 크기) 때문에 트랙을 넘어간다. 그런 경우엔 왼쪽이 아니라 오른쪽을
  // 기준으로 배치해 안쪽으로 자라게 한다.
  //
  // 임계값은 18px를 가장 좁은 트랙(compact 폭에서 약 488px) 기준으로 환산한
  // 값이다: 18 / 488 ≈ 3.7%. 이보다 타이트하면(예: 0.5%) 폭이 0.35%인 슬리버가
  // 왼쪽 기준으로 배치되어 min-inline-size만큼 밖으로 나간다.
  const anchoredRight = offset + width >= 96;
  const style = anchoredRight
    ? { insetInlineEnd: 0, inlineSize: `${Math.max(width, 100 - offset)}%` }
    : { insetInlineStart: `${offset}%`, inlineSize: `${width}%` };
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
      ref={(node) => registerRef(rowIndex, columnIndex, node)}
      style={style}
      // composite widget이므로 활성 항목만 Tab 정지를 갖는다.
      tabIndex={active ? 0 : -1}
      type="button"
    >
      <span aria-hidden="true">{segmentIcon(segment)}</span>
      <span className="truncate">{segment.label}</span>
      {/* DESIGN.md §5 TimelineSegment: 구조에 duration이 들어간다.
          라벨과 한 span에 묶으면 ellipsis가 시간부터 자른다. */}
      <span className="timeline-segment__duration">
        {formatDuration(segment.durationNs)}
      </span>
      <span className="sr-only">
        {segment.kind}, {segment.evidence}, {formatDuration(segment.durationNs)}
      </span>
    </button>
  );
}

function ScreenReaderEvents({ model }: { model: TimelineModel }) {
  return (
    <ol className="sr-only" aria-label="타임라인 이벤트 목록">
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
