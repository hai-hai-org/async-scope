import type { BufferSource } from "../../shared/api/schemas";
import { Button, StatusBadge } from "../../shared/ui";

type TimelineToolbarProps = {
  bufferSource: BufferSource;
  eventCount: number;
  windowLabel: string;
};

export function TimelineToolbar({
  bufferSource,
  eventCount,
  windowLabel,
}: TimelineToolbarProps) {
  return (
    <section className="timeline-toolbar" aria-label="Timeline controls">
      <div className="cluster">
        <Button disabled size="sm" variant="ghost">
          Pause · Day15
        </Button>
        <Button disabled size="sm" variant="ghost">
          −
        </Button>
        <span className="timeline-toolbar__window">{windowLabel}</span>
        <Button disabled size="sm" variant="ghost">
          +
        </Button>
      </div>
      <div className="cluster">
        <StatusBadge icon={bufferSource === "live" ? "●" : "↺"} tone="inferred">
          {bufferSource}
        </StatusBadge>
        <span className="field-help">{eventCount} events</span>
      </div>
    </section>
  );
}
