import { EmptyState, Panel } from "../../shared/ui";
import { RequestDetailPanel } from "../request-detail/RequestDetailPanel";
import type { RequestDetailState } from "../request-detail/useRequestDetail";
import type { TimelineSegment } from "./timeline";
import { formatDuration } from "./timeline";

type RequestInspectorProps = {
  detailState: RequestDetailState;
  onRetry: () => void;
  selectedSegment: TimelineSegment | null;
};

export function RequestInspector({
  detailState,
  onRetry,
  selectedSegment,
}: RequestInspectorProps) {
  if (selectedSegment?.rowId === "__tasks") {
    return (
      <Panel title="Request Detail">
        <EmptyState
          description={`${selectedSegment.label} · ${formatDuration(
            selectedSegment.durationNs,
          )}`}
          title="이 Task는 특정 요청에 속하지 않습니다"
        />
      </Panel>
    );
  }

  return (
    <RequestDetailPanel
      detailState={detailState}
      emptyDescription="타임라인에서 구간을 선택하면 상세 정보가 표시됩니다."
      emptyTitle="선택된 요청이 없습니다"
      initialSource={selectedSegment?.source ?? null}
      onRetry={onRetry}
      title="Request Detail"
    />
  );
}
