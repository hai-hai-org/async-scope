import { useMemo, useState } from "react";
import type { BufferSource, NormalizedEvent } from "../../shared/api/schemas";
import { Button, EmptyState, Panel, StatusBadge } from "../../shared/ui";
import { eventFixtures } from "../../test/fixtures";
import { TimelinePlot } from "./TimelinePlot";
import { TimelineToolbar } from "./TimelineToolbar";
import {
  buildTimelineModel,
  formatDuration,
  type TimelineSegment,
} from "./timeline";

type FixtureKey = keyof typeof eventFixtures;

const fixtureLabels: Record<FixtureKey, string> = {
  timeline: "two sleep requests",
  blocking: "blocking",
  unknownAwait: "unknown await",
  adapterAwaits: "adapter awaits",
};

type TimelinePageProps = {
  bufferSource: BufferSource;
  events?: NormalizedEvent[];
};

export function TimelinePage({ bufferSource, events }: TimelinePageProps) {
  const [fixtureKey, setFixtureKey] = useState<FixtureKey>("timeline");
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(
    null,
  );
  const isFixtureMode = events === undefined;
  const sourceEvents = isFixtureMode ? eventFixtures[fixtureKey] : events;
  const model = useMemo(() => buildTimelineModel(sourceEvents), [sourceEvents]);
  const selectedSegment = selectedSegmentId
    ? findSegment(
        model.rows.flatMap((row) => row.segments),
        selectedSegmentId,
      )
    : null;

  return (
    <div className="dashboard-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Day14</p>
          <h2>Timeline 기본 구조</h2>
          <p>
            fixture/export event를 request row, segment, blocking marker,
            playhead로 변환한다. live stream과 zoom control은 Day15 범위다.
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
          bufferSource={bufferSource}
          eventCount={sourceEvents.length}
          windowLabel={formatDuration(model.durationNs)}
        />
        <TimelinePlot
          model={model}
          onSelectSegment={setSelectedSegmentId}
          selectedSegmentId={selectedSegmentId}
        />
      </Panel>

      <section className="grid grid--two">
        <Panel
          description="Day16 RequestInspector의 입력이 될 최소 선택 상태다."
          title="Selection"
        >
          {selectedSegment ? (
            <SelectedSegment segment={selectedSegment} />
          ) : (
            <EmptyState
              description="Timeline segment를 선택하면 evidence, duration, source 요약을 보여 준다."
              title="선택된 segment 없음"
            />
          )}
        </Panel>
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

function SelectedSegment({ segment }: { segment: TimelineSegment }) {
  return (
    <dl className="metadata-grid">
      <div>
        <dt>label</dt>
        <dd>{segment.label}</dd>
      </div>
      <div>
        <dt>duration</dt>
        <dd>{formatDuration(segment.durationNs)}</dd>
      </div>
      <div>
        <dt>evidence</dt>
        <dd>{segment.evidence}</dd>
      </div>
      <div>
        <dt>source</dt>
        <dd>
          {segment.source
            ? `${segment.source.file}:${segment.source.line}`
            : "missing"}
        </dd>
      </div>
    </dl>
  );
}

function findSegment(segments: TimelineSegment[], id: string) {
  return segments.find((segment) => segment.id === id) ?? null;
}
