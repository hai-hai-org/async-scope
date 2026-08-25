import { EmptyState, Panel } from "../../shared/ui";

export function AnalyzerPage() {
  return (
    <Panel
      description="finding list, severity/evidence filter, recommendation detail은 Day19 범위다."
      title="Analyzer"
    >
      <EmptyState
        description="Timeline 기본 구조가 먼저 안정된 뒤 finding deep link를 연결한다."
        title="Analyzer 화면은 다음 단계에서 구현"
      />
    </Panel>
  );
}
