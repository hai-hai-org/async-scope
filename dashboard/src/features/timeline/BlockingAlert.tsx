import { useEffect, useMemo } from "react";
import {
  type ClockAnchor,
  formatDuration,
  formatWallClock,
} from "../../shared/api/eventStore";
import type { FindingPayload } from "../../shared/api/schemas";
import { useFindings } from "../../shared/api/useFindings";
import { StatusBadge } from "../../shared/ui";
import {
  RecommendationSteps,
  sourceLabel,
} from "../analyzer/RecommendationSteps";

type BlockingAlertProps = {
  /**
   * summary가 2초마다 폴링하는 값이다. 이 값이 바뀔 때만 finding을 다시 읽어
   * 폴링 루프를 두 개 만들지 않는다.
   */
  blockingCount: number;
  clockAnchor: ClockAnchor | null;
};

/**
 * 이 제품의 핵심 순간이다. Timeline에서 "무엇이 Event Loop를 막았고 어떻게
 * 고치는가"를 바로 보여 준다. 상세는 Analyzer로 넘긴다 — 알림에 다 담지 않는다.
 */
export function BlockingAlert({
  blockingCount,
  clockAnchor,
}: BlockingAlertProps) {
  const query = useMemo(
    () => ({ page: 1, page_size: 1, type: "blocking" as const }),
    [],
  );
  const findings = useFindings(query);
  const { reload } = findings;

  // blockingCount는 effect 본문에서 쓰이지 않지만 이 재조회의 트리거다.
  // "blocking 수가 변했을 때만 다시 읽는다"가 의도이므로 의존성에 남긴다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 값이 아니라 신호다
  useEffect(() => {
    reload();
  }, [blockingCount, reload]);

  const finding = findings.state.data?.items[0] ?? null;
  const total = findings.state.data?.total ?? 0;

  // finding이 없으면 빈 껍데기를 두지 않는다.
  if (!finding) {
    return null;
  }

  return (
    <section className="blocking-alert" aria-labelledby="blocking-alert-title">
      {/* 새 finding은 focus를 빼앗지 않고 count만 알린다 (DESIGN.md §5). */}
      <p aria-live="polite" className="sr-only">
        블로킹 {total}건이 감지되었습니다.
      </p>

      <div className="blocking-alert__head">
        <span aria-hidden="true" className="blocking-alert__icon">
          !
        </span>
        <div className="blocking-alert__heading">
          <h3 className="blocking-alert__title" id="blocking-alert-title">
            {finding.title}
          </h3>
          <p className="blocking-alert__meta">
            {finding.duration_ns != null
              ? `${formatDuration(finding.duration_ns)} 동안`
              : null}
            {finding.duration_ns != null ? " · " : null}
            {formatWallClock(finding.detected_at_ns, clockAnchor)}
            {total > 1 ? ` · 최근 ${total}건 중 마지막` : null}
          </p>
        </div>
        <div className="cluster">
          <StatusBadge
            icon={finding.severity === "high" ? "!" : "△"}
            tone={finding.severity === "high" ? "error" : "warning"}
          >
            {finding.severity}
          </StatusBadge>
          <a className="button button--ghost button--sm" href="#/analyzer">
            자세히
          </a>
        </div>
      </div>

      {/* 추론이면 그 사실을 해결 방법보다 먼저 말한다 (ADR-0001 §6). */}
      {finding.evidence === "inferred" ? (
        <p className="blocking-alert__inferred">
          <StatusBadge icon="△" tone="inferred">
            inferred
          </StatusBadge>
          <span>
            관찰이 아니라 추론된 원인입니다
            {finding.confidence != null
              ? ` (신뢰도 ${Math.round(finding.confidence * 100)}%)`
              : ""}
            . 아래는 확정된 진단이 아니라 확인할 후보입니다.
          </span>
        </p>
      ) : null}

      <Suspect finding={finding} />

      <div className="blocking-alert__fix">
        <h4>어떻게 해결할 수 있나요?</h4>
        <RecommendationSteps steps={finding.recommendation.steps} />
      </div>
    </section>
  );
}

function Suspect({ finding }: { finding: FindingPayload }) {
  const request = finding.affected_requests[0];
  if (!finding.suspect && !request) {
    return null;
  }
  return (
    <dl className="blocking-alert__facts">
      {request ? (
        <div>
          <dt>영향받은 요청</dt>
          <dd>
            {request.method ?? "GET"} {request.path ?? request.request_id}
          </dd>
        </div>
      ) : null}
      {finding.suspect ? (
        <div>
          <dt>원인 후보</dt>
          <dd>{finding.suspect.label ?? "—"}</dd>
        </div>
      ) : null}
      {finding.suspect?.source ? (
        <div>
          <dt>코드 위치</dt>
          <dd>{sourceLabel(finding.suspect.source)}</dd>
        </div>
      ) : null}
    </dl>
  );
}
