import { useEffect, useMemo, useState } from "react";
import type {
  FindingFeedbackKind,
  FindingPayload,
  SourceReference,
} from "../../shared/api/schemas";
import { Button, EmptyState, Panel, StatusBadge } from "../../shared/ui";
import { SourceViewer } from "../request-detail/SourceViewer";
import { formatDuration, formatTimestamp } from "../timeline/timeline";
import { severityTone } from "./FindingsTable";
import type { FindingDetailState } from "./useFindingDetail";

type FindingDetailProps = {
  detailState: FindingDetailState;
  feedbackError: string | null;
  feedbackPending: FindingFeedbackKind | null;
  onFeedback: (kind: FindingFeedbackKind) => Promise<void>;
  onRetry: () => void;
};

export function FindingDetail({
  detailState,
  feedbackError,
  feedbackPending,
  onFeedback,
  onRetry,
}: FindingDetailProps) {
  const finding = detailState.data;
  const firstSource = useMemo(
    () => (finding ? firstFindingSource(finding) : null),
    [finding],
  );
  const [selectedSource, setSelectedSource] = useState<SourceReference | null>(
    firstSource,
  );

  useEffect(() => {
    setSelectedSource(firstSource);
  }, [firstSource]);

  if (detailState.state === "idle") {
    return (
      <Panel
        description="finding을 선택하면 원인 후보와 recommendation을 표시한다."
        title="Finding detail"
      >
        <EmptyState
          description="Analyzer 목록에서 finding row를 선택한다."
          title="선택된 finding 없음"
        />
      </Panel>
    );
  }

  if (detailState.state === "loading") {
    return (
      <Panel
        description="finding detail API를 불러오는 중이다."
        state="loading"
        title="Finding detail"
      >
        <span />
      </Panel>
    );
  }

  if (!finding) {
    return (
      <Panel
        actions={
          <Button onClick={onRetry} size="sm" variant="ghost">
            Retry
          </Button>
        }
        description={detailState.error ?? "finding detail을 만들 수 없다."}
        title="Finding detail"
      >
        <EmptyState
          description="finding이 buffer에서 사라졌거나 API를 사용할 수 없는 상태일 수 있다."
          title="Finding detail unavailable"
        />
      </Panel>
    );
  }

  return (
    <Panel
      actions={
        <StatusBadge
          icon={severityIcon(finding.severity)}
          tone={severityTone(finding.severity)}
        >
          {finding.severity}
        </StatusBadge>
      }
      description="finding evidence, affected request, recommendation과 source를 함께 표시한다."
      title="Finding detail"
    >
      <div className="finding-detail">
        <header className="finding-detail__header">
          <div>
            <p className="eyebrow">{finding.type}</p>
            <h4>{finding.title}</h4>
          </div>
          <StatusBadge
            icon={finding.evidence === "observed" ? "●" : "△"}
            tone={finding.evidence === "observed" ? "observed" : "inferred"}
          >
            {finding.evidence}
          </StatusBadge>
        </header>

        <ConfidenceNotice finding={finding} />
        <FindingMetadata finding={finding} />
        <FeedbackControls
          error={feedbackError}
          finding={finding}
          onFeedback={onFeedback}
          pending={feedbackPending}
        />

        <div className="finding-detail__grid">
          <div className="finding-detail__main">
            <SuspectPanel
              finding={finding}
              onSelectSource={setSelectedSource}
            />
            <AffectedRequests finding={finding} />
            <RecommendationPanel
              finding={finding}
              onSelectSource={setSelectedSource}
              selectedSource={selectedSource}
            />
          </div>
          <SourceViewer source={selectedSource} />
        </div>
      </div>
    </Panel>
  );
}

function ConfidenceNotice({ finding }: { finding: FindingPayload }) {
  const inferred = finding.evidence !== "observed";
  const uncertain =
    finding.recommendation.certainty !== "observed" ||
    finding.suspect?.certainty === "candidate";

  if (!inferred && !uncertain) {
    return null;
  }

  return (
    <div className="finding-notice">
      <strong>확정 원인이 아니라 후보로 해석해야 한다.</strong>
      <span>
        {inferred
          ? "이 finding은 추론 evidence를 포함한다. "
          : "관측된 finding이다. "}
        recommendation certainty는 {finding.recommendation.certainty}이다.
      </span>
    </div>
  );
}

function FindingMetadata({ finding }: { finding: FindingPayload }) {
  return (
    <dl className="metadata-grid">
      <div>
        <dt>finding_id</dt>
        <dd className="mono">{finding.finding_id}</dd>
      </div>
      <div>
        <dt>duration</dt>
        <dd>{formatDuration(finding.duration_ns)}</dd>
      </div>
      <div>
        <dt>threshold</dt>
        <dd>{formatDuration(finding.threshold_ns)}</dd>
      </div>
      <div>
        <dt>detected</dt>
        <dd>{formatTimestamp(finding.detected_at_ns)}</dd>
      </div>
      <div>
        <dt>confidence</dt>
        <dd>{formatConfidence(finding.confidence)}</dd>
      </div>
      <div>
        <dt>recommendation</dt>
        <dd>
          {finding.recommendation.kind} · {finding.recommendation.certainty}
        </dd>
      </div>
    </dl>
  );
}

function FeedbackControls({
  error,
  finding,
  onFeedback,
  pending,
}: {
  error: string | null;
  finding: FindingPayload;
  onFeedback: (kind: FindingFeedbackKind) => Promise<void>;
  pending: FindingFeedbackKind | null;
}) {
  return (
    <section className="finding-feedback" aria-label="Finding feedback">
      <div>
        <strong>Feedback</strong>
        <p>
          기록된 feedback은 finding을 숨기지 않는다. 숨김은 UI 정책이 아니다.
        </p>
      </div>
      <div className="cluster">
        <Button
          disabled={finding.feedback.acknowledged}
          loading={pending === "acknowledged"}
          onClick={() => onFeedback("acknowledged")}
          size="sm"
          variant={finding.feedback.acknowledged ? "secondary" : "ghost"}
        >
          {finding.feedback.acknowledged ? "Acknowledged" : "Acknowledge"}
        </Button>
        <Button
          disabled={finding.feedback.false_positive}
          loading={pending === "false_positive"}
          onClick={() => onFeedback("false_positive")}
          size="sm"
          variant={finding.feedback.false_positive ? "secondary" : "ghost"}
        >
          {finding.feedback.false_positive
            ? "False positive"
            : "Mark false positive"}
        </Button>
      </div>
      {error ? (
        <p className="field-help finding-feedback__error">{error}</p>
      ) : null}
    </section>
  );
}

function SuspectPanel({
  finding,
  onSelectSource,
}: {
  finding: FindingPayload;
  onSelectSource: (source: SourceReference | null) => void;
}) {
  const suspect = finding.suspect;
  return (
    <section className="finding-card" aria-label="Suspect">
      <div className="finding-card__header">
        <strong>Suspect</strong>
        {suspect ? (
          <StatusBadge
            icon={suspect.certainty === "observed" ? "●" : "△"}
            tone={suspect.certainty === "observed" ? "observed" : "inferred"}
          >
            {suspect.certainty}
          </StatusBadge>
        ) : null}
      </div>
      {suspect ? (
        <div className="finding-card__body">
          <dl className="finding-kv">
            <div>
              <dt>label</dt>
              <dd>{suspect.label ?? "—"}</dd>
            </div>
            <div>
              <dt>request_id</dt>
              <dd>{suspect.request_id ?? "—"}</dd>
            </div>
            <div>
              <dt>span_id</dt>
              <dd>{suspect.span_id ?? "—"}</dd>
            </div>
            <div>
              <dt>source</dt>
              <dd>{sourceLabel(suspect.source)}</dd>
            </div>
          </dl>
          <div className="cluster">
            <Button
              disabled={!suspect.source}
              onClick={() => onSelectSource(suspect.source)}
              size="sm"
              variant="ghost"
            >
              Source 보기
            </Button>
            <a className="button button--sm button--ghost" href="#/timeline">
              Timeline 열기
            </a>
          </div>
        </div>
      ) : (
        <EmptyState
          description="unattributed finding이나 source를 특정할 수 없는 finding은 원인 후보 없이 측정 안내를 먼저 보여 준다."
          title="원인 후보 없음"
        />
      )}
    </section>
  );
}

function AffectedRequests({ finding }: { finding: FindingPayload }) {
  return (
    <section className="finding-card" aria-label="Affected requests">
      <div className="finding-card__header">
        <strong>Affected requests</strong>
        <span>{finding.affected_requests.length} requests</span>
      </div>
      {finding.affected_requests.length ? (
        <ul className="affected-requests">
          {finding.affected_requests.map((request) => (
            <li key={request.request_id}>
              <a
                href={`#/requests?request_id=${encodeURIComponent(request.request_id)}`}
              >
                <span className="mono">{request.method ?? "GET"}</span>
                <strong>{request.path ?? request.request_id}</strong>
                <span>{formatTimestamp(request.started_at_ns)}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          description="해당 finding이 특정 request window와 겹치지 않았다."
          title="영향받은 request 없음"
        />
      )}
    </section>
  );
}

function RecommendationPanel({
  finding,
  onSelectSource,
  selectedSource,
}: {
  finding: FindingPayload;
  onSelectSource: (source: SourceReference | null) => void;
  selectedSource: SourceReference | null;
}) {
  return (
    <section className="finding-card" aria-label="Recommendation">
      <div className="finding-card__header">
        <div>
          <strong>Recommendation</strong>
          <p>
            {finding.recommendation.kind} · {finding.recommendation.certainty}
          </p>
        </div>
        <StatusBadge
          icon={finding.recommendation.certainty === "observed" ? "●" : "△"}
          tone={
            finding.recommendation.certainty === "observed"
              ? "observed"
              : "inferred"
          }
        >
          {finding.recommendation.certainty}
        </StatusBadge>
      </div>
      <ol className="recommendation-steps">
        {finding.recommendation.steps.map((step) => {
          const selected = sameSource(selectedSource, step.source);
          return (
            <li key={recommendationStepKey(step)}>
              <p>{step.text}</p>
              {step.source ? (
                <Button
                  className={selected ? "is-active" : undefined}
                  onClick={() => onSelectSource(step.source)}
                  size="sm"
                  variant="ghost"
                >
                  {sourceLabel(step.source)}
                </Button>
              ) : (
                <span className="field-help">source 없음 · 추가 측정 안내</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function firstFindingSource(finding: FindingPayload): SourceReference | null {
  if (finding.suspect?.source) {
    return finding.suspect.source;
  }
  return (
    finding.recommendation.steps.find((step) => step.source !== null)?.source ??
    null
  );
}

function recommendationStepKey({
  source,
  text,
}: FindingPayload["recommendation"]["steps"][number]) {
  return `${text}-${source?.file ?? "none"}-${source?.line ?? "none"}`;
}

function sourceLabel(source: SourceReference | null) {
  if (!source) {
    return "—";
  }
  return `${source.file}:${source.line}`;
}

function sameSource(
  left: SourceReference | null,
  right: SourceReference | null,
) {
  return Boolean(
    left && right && left.file === right.file && left.line === right.line,
  );
}

function formatConfidence(confidence: number | null) {
  if (confidence == null) {
    return "—";
  }
  return `${Math.round(confidence * 100)}%`;
}

function severityIcon(severity: FindingPayload["severity"]) {
  if (severity === "high") {
    return "!";
  }
  if (severity === "medium") {
    return "△";
  }
  return "i";
}
