import type { SourceReference } from "../../shared/api/schemas";
import { Button, EmptyState, Panel } from "../../shared/ui";
import { useSourceSnippet } from "./useSourceSnippet";

type SourceViewerProps = {
  source: SourceReference | null;
};

export function SourceViewer({ source }: SourceViewerProps) {
  const snippet = useSourceSnippet(source);

  if (!source || snippet.state.state === "missing") {
    return (
      <Panel title="코드 위치">
        <EmptyState
          description="프로젝트 밖의 코드이거나, 런타임 내부 프레임이어서 표시하지 않습니다."
          title="표시할 코드가 없습니다"
        />
      </Panel>
    );
  }

  if (snippet.state.state === "idle" || snippet.state.state === "loading") {
    return (
      <Panel
        description={`${source.file}:${source.line}`}
        state="loading"
        title="코드 위치"
      >
        <span />
      </Panel>
    );
  }

  if (snippet.state.state === "error") {
    return (
      <Panel
        actions={
          <Button onClick={snippet.reload} size="sm" variant="ghost">
            Retry
          </Button>
        }
        description={snippet.state.error}
        title="코드 위치"
      >
        <EmptyState
          description="프로젝트 경로 밖의 파일, Python이 아닌 파일, 권한이 없는 파일은 열지 않습니다."
          title="코드를 읽을 수 없습니다"
        />
      </Panel>
    );
  }

  const data = snippet.state.data;

  return (
    <Panel description={`${data.file}:${source.line}`} title="코드 위치">
      <pre className="source-viewer">
        {data.lines.map((line, index) => {
          const lineNumber = data.start_line + index;
          const highlighted = lineNumber === source.line;
          return (
            <code
              className={highlighted ? "is-highlighted" : undefined}
              data-line={lineNumber}
              key={`${lineNumber}-${line}`}
            >
              {line || " "}
            </code>
          );
        })}
      </pre>
    </Panel>
  );
}
