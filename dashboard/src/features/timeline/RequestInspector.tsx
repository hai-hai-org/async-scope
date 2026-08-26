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
      <Panel
        description="background task는 request_id가 없으므로 request detail API 대상이 아니다."
        title="Request detail"
      >
        <EmptyState
          description={`${selectedSegment.label} · ${formatDuration(
            selectedSegment.durationNs,
          )}`}
          title="Background task segment"
        />
      </Panel>
    );
  }

  return (
    <RequestDetailPanel
      detailState={detailState}
      emptyDescription="Timeline segment를 선택하면 request metadata, 실행 흐름과 source를 보여 준다."
      emptyTitle="선택된 request 없음"
      initialSource={selectedSegment?.source ?? null}
      onRetry={onRetry}
      title="Request detail"
    />
  );
}
