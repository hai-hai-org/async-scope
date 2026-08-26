import { useEffect, useState } from "react";
import type {
  Evidence,
  FindingFeedbackKind,
  FindingSeverity,
  FindingsQuery,
  FindingType,
} from "../../shared/api/schemas";
import {
  DEFAULT_FINDINGS_QUERY,
  useFindings,
} from "../../shared/api/useFindings";
import { Button, EmptyState, Panel, StatusBadge } from "../../shared/ui";
import { FindingDetail } from "./FindingDetail";
import { FindingsTable } from "./FindingsTable";
import { useFindingDetail } from "./useFindingDetail";

type FindingsDraft = {
  evidence: "" | Evidence;
  page_size: number;
  severity: "" | FindingSeverity;
  type: "" | FindingType;
};

const FINDING_TYPES: FindingType[] = ["blocking", "long_wait", "unattributed"];

const FINDING_SEVERITIES: FindingSeverity[] = ["high", "medium", "low"];
const FINDING_EVIDENCES: Evidence[] = ["observed", "inferred"];

export function AnalyzerPage() {
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(
    () => findingIdFromHash(),
  );
  const [query, setQuery] = useState<FindingsQuery>(DEFAULT_FINDINGS_QUERY);
  const [draft, setDraft] = useState<FindingsDraft>(() =>
    draftFromQuery(query),
  );
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const findings = useFindings(query);
  const detail = useFindingDetail(selectedFindingId);

  useEffect(() => {
    const syncSelected = () => {
      setFeedbackError(null);
      setSelectedFindingId(findingIdFromHash());
    };
    window.addEventListener("hashchange", syncSelected);
    return () => window.removeEventListener("hashchange", syncSelected);
  }, []);

  useEffect(() => {
    if (!selectedFindingId && findings.state.data?.items.length) {
      setSelectedFindingId(findings.state.data.items[0].finding_id);
    }
  }, [findings.state.data, selectedFindingId]);

  const applyFilters = () => {
    setQuery({
      page: 1,
      page_size: draft.page_size,
      ...(draft.type ? { type: draft.type } : {}),
      ...(draft.severity ? { severity: draft.severity } : {}),
      ...(draft.evidence ? { evidence: draft.evidence } : {}),
    });
  };
  const selectFinding = (findingId: string) => {
    setFeedbackError(null);
    setSelectedFindingId(findingId);
    setFindingIdHash(findingId);
  };
  const markFeedback = async (kind: FindingFeedbackKind) => {
    setFeedbackError(null);
    try {
      await detail.markFeedback(kind);
      findings.reload();
    } catch (error) {
      setFeedbackError(
        error instanceof Error ? error.message : "feedback failed",
      );
    }
  };

  return (
    <div className="dashboard-page analyzer-page">
      <section className="analyzer-layout">
        <Panel
          actions={
            <>
              <StatusBadge icon="!" tone="inferred">
                {findings.state.data?.total ?? 0} findings
              </StatusBadge>
              <Button onClick={findings.reload} size="sm" variant="ghost">
                새로 고침
              </Button>
            </>
          }
          title="발견된 문제"
        >
          <FindingsFilters
            draft={draft}
            onApply={applyFilters}
            onChange={setDraft}
          />
          <FindingsListBody
            findings={findings}
            onSelect={selectFinding}
            query={query}
            selectedFindingId={selectedFindingId}
            setQuery={setQuery}
          />
        </Panel>

        <FindingDetail
          detailState={detail.state}
          feedbackError={feedbackError}
          feedbackPending={detail.feedbackPending}
          onFeedback={markFeedback}
          onRetry={detail.reload}
        />
      </section>
    </div>
  );
}

function FindingsFilters({
  draft,
  onApply,
  onChange,
}: {
  draft: FindingsDraft;
  onApply: () => void;
  onChange: (draft: FindingsDraft) => void;
}) {
  return (
    <form
      className="findings-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <label>
        <span>종류</span>
        <select
          onChange={(event) =>
            onChange({
              ...draft,
              type: event.target.value as FindingsDraft["type"],
            })
          }
          value={draft.type}
        >
          <option value="">전체</option>
          {FINDING_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>심각도</span>
        <select
          onChange={(event) =>
            onChange({
              ...draft,
              severity: event.target.value as FindingsDraft["severity"],
            })
          }
          value={draft.severity}
        >
          <option value="">전체</option>
          {FINDING_SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {severity}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>근거</span>
        <select
          onChange={(event) =>
            onChange({
              ...draft,
              evidence: event.target.value as FindingsDraft["evidence"],
            })
          }
          value={draft.evidence}
        >
          <option value="">전체</option>
          {FINDING_EVIDENCES.map((evidence) => (
            <option key={evidence} value={evidence}>
              {evidence}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>표시 개수</span>
        <select
          onChange={(event) =>
            onChange({ ...draft, page_size: Number(event.target.value) })
          }
          value={draft.page_size}
        >
          <option value={50}>50</option>
          <option value={100}>100</option>
        </select>
      </label>
      <Button size="sm" type="submit" variant="primary">
        적용
      </Button>
    </form>
  );
}

function FindingsListBody({
  findings,
  onSelect,
  query,
  selectedFindingId,
  setQuery,
}: {
  findings: ReturnType<typeof useFindings>;
  onSelect: (findingId: string) => void;
  query: FindingsQuery;
  selectedFindingId: string | null;
  setQuery: (query: FindingsQuery) => void;
}) {
  if (findings.state.state === "loading") {
    return (
      <div className="panel__state" aria-busy="true">
        <span className="skeleton" />
        <span className="skeleton" style={{ inlineSize: "72%" }} />
        <span>분석 결과를 불러오는 중입니다.</span>
      </div>
    );
  }

  if (findings.state.state === "error") {
    return (
      <EmptyState
        description={findings.state.error}
        title="분석 결과를 불러오지 못했습니다"
      />
    );
  }

  return (
    <div className="findings-list">
      {findings.state.state === "empty" ? (
        <EmptyState
          description="필터를 지우거나, 앱에 요청을 보낸 뒤 다시 확인해 보세요."
          title="조건에 맞는 문제가 없습니다"
        />
      ) : (
        <FindingsTable
          findings={findings.state.data.items}
          onSelect={onSelect}
          selectedFindingId={selectedFindingId}
        />
      )}
      <PaginationControls
        hasNext={findings.state.data.has_next}
        page={findings.state.data.page}
        pageSize={findings.state.data.page_size}
        setPage={(page) => setQuery({ ...query, page })}
        total={findings.state.data.total}
      />
    </div>
  );
}

function PaginationControls({
  hasNext,
  page,
  pageSize,
  setPage,
  total,
}: {
  hasNext: boolean;
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  total: number;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(total, page * pageSize);
  return (
    <div className="pagination-controls">
      <span className="field-help">
        {start}-{end} / {total}
      </span>
      <div className="cluster">
        <Button
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
          size="sm"
          variant="ghost"
        >
          이전
        </Button>
        <Button
          disabled={!hasNext}
          onClick={() => setPage(page + 1)}
          size="sm"
          variant="ghost"
        >
          다음
        </Button>
      </div>
    </div>
  );
}

function draftFromQuery(query: FindingsQuery): FindingsDraft {
  return {
    evidence: query.evidence ?? "",
    page_size: query.page_size,
    severity: query.severity ?? "",
    type: query.type ?? "",
  };
}

function findingIdFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(query).get("finding_id");
}

function setFindingIdHash(findingId: string) {
  const params = new URLSearchParams({ finding_id: findingId });
  window.location.hash = `/analyzer?${params}`;
}
