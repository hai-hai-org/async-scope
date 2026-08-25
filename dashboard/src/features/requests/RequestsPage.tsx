import { EmptyState, Panel } from "../../shared/ui";

export function RequestsPage() {
  return (
    <Panel
      description="검색, filter, sort, pagination, virtualization은 Day18 범위다."
      title="Requests"
    >
      <EmptyState
        description="이번 PR에서는 route와 AppShell 연결만 유지한다."
        title="Requests 화면은 다음 단계에서 구현"
      />
    </Panel>
  );
}
