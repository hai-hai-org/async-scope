import type {
  RecommendationStep,
  SourceReference,
} from "../../shared/api/schemas";
import { Button } from "../../shared/ui";

type RecommendationStepsProps = {
  steps: RecommendationStep[];
  /** 코드 위치를 눌렀을 때 동작. 없으면 위치를 읽기 전용 텍스트로 보여 준다. */
  onSelectSource?: (source: SourceReference) => void;
  selectedSource?: SourceReference | null;
};

/**
 * Analyzer 상세와 Timeline의 BlockingAlert가 같은 목록을 쓴다.
 * 문장 자체는 백엔드가 검증된 규칙에서만 만들므로 화면은 표시만 한다.
 */
export function RecommendationSteps({
  onSelectSource,
  selectedSource,
  steps,
}: RecommendationStepsProps) {
  return (
    <ol className="recommendation-steps">
      {steps.map((step) => (
        <li key={recommendationStepKey(step)}>
          <p>{step.text}</p>
          {step.source ? (
            onSelectSource ? (
              <Button
                className={
                  sameSource(selectedSource ?? null, step.source)
                    ? "is-active"
                    : undefined
                }
                onClick={() => onSelectSource(step.source as SourceReference)}
                size="sm"
                variant="ghost"
              >
                {sourceLabel(step.source)}
              </Button>
            ) : (
              <span className="field-help">{sourceLabel(step.source)}</span>
            )
          ) : (
            <span className="field-help">
              코드 위치 없음 · 측정 안내만 제공
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

export function recommendationStepKey(step: RecommendationStep) {
  return step.source
    ? `${step.text}:${step.source.file}:${step.source.line}`
    : step.text;
}

/** 위치가 없으면 만들어내지 않는다 — 없다고 표시한다. */
export function sourceLabel(source: SourceReference | null) {
  return source ? `${source.file}:${source.line}` : "—";
}

export function sameSource(
  a: SourceReference | null,
  b: SourceReference | null,
) {
  if (!a || !b) {
    return false;
  }
  return a.file === b.file && a.line === b.line;
}
