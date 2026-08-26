import type { SourceLocation } from "../../shared/api/schemas";
import { Button, EmptyState, Panel } from "../../shared/ui";
import { useSourceSnippet } from "./useSourceSnippet";

type SourceViewerProps = {
  source: SourceLocation | null;
};

export function SourceViewer({ source }: SourceViewerProps) {
  const snippet = useSourceSnippet(source);

  if (!source || snippet.state.state === "missing") {
    return (
      <Panel
        description="source가 없는 span은 project file로 연결하지 않는다."
        title="SourceViewer"
      >
        <EmptyState
          description="missing source는 안전 경계, ring buffer truncation, runtime 내부 frame 때문에 발생할 수 있다."
          title="Source 없음"
        />
      </Panel>
    );
  }

  if (snippet.state.state === "idle" || snippet.state.state === "loading") {
    return (
      <Panel
        description={`${source.file}:${source.line}`}
        state="loading"
        title="SourceViewer"
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
        title="SourceViewer"
      >
        <EmptyState
          description="project root 밖, 비 Python 파일, 없는 파일, 권한 문제는 snippet을 표시하지 않는다."
          title="Source를 읽을 수 없음"
        />
      </Panel>
    );
  }

  const data = snippet.state.data;

  return (
    <Panel description={`${data.file}:${source.line}`} title="SourceViewer">
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
