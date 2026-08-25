import { EmptyState, Panel } from "../../shared/ui";

export function SettingsPage() {
  return (
    <Panel
      description="Settings form, theme persistence, validation states는 Day20 범위다."
      title="Settings"
    >
      <EmptyState
        description="Day12 theme token은 이미 동작하며 실제 form은 별도 PR에서 연결한다."
        title="Settings 화면은 다음 단계에서 구현"
      />
    </Panel>
  );
}
