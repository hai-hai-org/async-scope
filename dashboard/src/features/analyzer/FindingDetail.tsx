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
import {
  RecommendationSteps,
  sameSource,
  sourceLabel,
} from "./RecommendationSteps";
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
      <Panel title="문제 상세">
        <EmptyState
          description="목록에서 항목을 선택하면 원인 후보와 해결 방법이 표시됩니다."
          title="선택된 항목이 없습니다"
        />
      </Panel>
    );
  }

  if (detailState.state === "loading") {
    return (
      <Panel
        description="상세 정보를 불러오는 중입니다."
        state="loading"
        title="문제 상세"
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
        title="문제 상세"
      >
        <EmptyState
          description="오래된 항목이 버퍼에서 밀려났거나, 앱과 연결되지 않았을 수 있습니다."
          title="상세 정보를 불러오지 못했습니다"
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
      title="문제 상세"
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
      <strong>확정된 원인이 아니라 후보입니다.</strong>
      <span>
        {inferred
          ? "이 finding은 추론 evidence를 포함한다. "
          : "관측된 finding이다. "}
        해결 방법의 확실성은 {finding.recommendation.certainty} 수준입니다.
      </span>
    </div>
  );
}

function FindingMetadata({ finding }: { finding: FindingPayload }) {
  return (
    <dl className="metadata-grid">
      <div>
        <dt>항목 ID</dt>
        <dd className="mono">{finding.finding_id}</dd>
      </div>
      <div>
        <dt>지속 시간</dt>
        <dd>{formatDuration(finding.duration_ns)}</dd>
      </div>
      <div>
        <dt>감지 기준</dt>
        <dd>{formatDuration(finding.threshold_ns)}</dd>
      </div>
      <div>
        <dt>감지 시각</dt>
        <dd>{formatTimestamp(finding.detected_at_ns)}</dd>
      </div>
      <div>
        <dt>신뢰도</dt>
        <dd>{formatConfidence(finding.confidence)}</dd>
      </div>
      <div>
        <dt>해결 방법</dt>
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
    <section className="finding-feedback" aria-label="피드백">
      <div>
        <strong>이 판단이 맞나요?</strong>
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
          {finding.feedback.acknowledged ? "확인함" : "확인했다고 표시"}
        </Button>
        <Button
          disabled={finding.feedback.false_positive}
          loading={pending === "false_positive"}
          onClick={() => onFeedback("false_positive")}
          size="sm"
          variant={finding.feedback.false_positive ? "secondary" : "ghost"}
        >
          {finding.feedback.false_positive ? "False positive" : "오탐으로 표시"}
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
    <section className="finding-card" aria-label="원인 후보">
      <div className="finding-card__header">
        <strong>원인 후보</strong>
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
              <dt>이름</dt>
              <dd>{suspect.label ?? "—"}</dd>
            </div>
            <div>
              <dt>요청 ID</dt>
              <dd>{suspect.request_id ?? "—"}</dd>
            </div>
            <div>
              <dt>구간 ID</dt>
              <dd>{suspect.span_id ?? "—"}</dd>
            </div>
            <div>
              <dt>코드 위치</dt>
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
              코드 보기
            </Button>
            <a className="button button--sm button--ghost" href="#/timeline">
              타임라인에서 보기
            </a>
          </div>
        </div>
      ) : (
        <EmptyState
          description="원인을 특정할 증거가 부족합니다. 아래 측정 안내를 먼저 따라가 보세요."
          title="원인 후보를 지목하지 않았습니다"
        />
      )}
    </section>
  );
}

function AffectedRequests({ finding }: { finding: FindingPayload }) {
  return (
    <section className="finding-card" aria-label="영향받은 요청">
      <div className="finding-card__header">
        <strong>영향받은 요청</strong>
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
          description="이 구간과 겹치는 요청이 버퍼에 없습니다."
          title="영향받은 요청이 없습니다"
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
    <section className="finding-card" aria-label="해결 방법">
      <div className="finding-card__header">
        <div>
          <strong>해결 방법</strong>
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
      <RecommendationSteps
        onSelectSource={onSelectSource}
        selectedSource={selectedSource}
        steps={finding.recommendation.steps}
      />
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
