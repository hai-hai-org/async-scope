import { useEffect, useMemo, useState } from "react";
import type { ClockAnchor } from "../../shared/api/eventStore";
import type {
  RequestOrder,
  RequestSort,
  RequestStatus,
  RequestsQuery,
} from "../../shared/api/schemas";
import {
  Button,
  Drawer,
  EmptyState,
  Panel,
  StatusBadge,
} from "../../shared/ui";
import { RequestDetailPanel } from "../request-detail/RequestDetailPanel";
import { useRequestDetail } from "../request-detail/useRequestDetail";
import { RequestsTable } from "./RequestsTable";
import { DEFAULT_REQUESTS_QUERY, useRequests } from "./useRequests";

// 정렬은 draft에 두지 않는다. 표 헤더가 query를 직접 바꾼다.
type RequestsDraft = {
  method: string;
  page_size: number;
  path: string;
  q: string;
  status: "" | RequestStatus;
};

const REQUEST_STATUSES: RequestStatus[] = [
  "running",
  "completed",
  "failed",
  "cancelled",
  "disconnected",
];

export function RequestsPage({
  clockAnchor,
}: {
  clockAnchor: ClockAnchor | null;
}) {
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(
    () => requestIdFromHash(),
  );
  const [query, setQuery] = useState<RequestsQuery>(DEFAULT_REQUESTS_QUERY);
  const [draft, setDraft] = useState<RequestsDraft>(() =>
    draftFromQuery(query),
  );
  const [drawerOpen, setDrawerOpen] = useState(false);
  const requests = useRequests(query);
  const detail = useRequestDetail({
    requestId: selectedRequestId,
  });
  const selectedRequest = useMemo(
    () =>
      requests.state.data?.items.find(
        (request) => request.request_id === selectedRequestId,
      ) ?? null,
    [requests.state.data, selectedRequestId],
  );

  useEffect(() => {
    const syncSelected = () => setSelectedRequestId(requestIdFromHash());
    window.addEventListener("hashchange", syncSelected);
    return () => window.removeEventListener("hashchange", syncSelected);
  }, []);

  useEffect(() => {
    if (!selectedRequestId && requests.state.data?.items.length) {
      setSelectedRequestId(requests.state.data.items[0].request_id);
    }
  }, [requests.state.data, selectedRequestId]);

  const applyFilters = () => {
    setQuery({
      order: query.order,
      page: 1,
      page_size: draft.page_size,
      sort: query.sort,
      ...(draft.q ? { q: draft.q } : {}),
      ...(draft.status ? { status: draft.status } : {}),
      ...(draft.method ? { method: draft.method.toUpperCase() } : {}),
      ...(draft.path ? { path: draft.path } : {}),
    });
  };
  const applySort = (sort: RequestSort, order: RequestOrder) => {
    // 정렬을 바꾸면 첫 페이지부터 다시 본다.
    setQuery({ ...query, order, page: 1, sort });
  };
  const selectRequest = (requestId: string) => {
    setSelectedRequestId(requestId);
    setDrawerOpen(true);
    setRequestIdHash(requestId);
  };

  return (
    <div className="dashboard-page requests-page">
      <section className="requests-layout">
        <Panel
          actions={
            <>
              <StatusBadge icon="≡" tone="observed">
                {requests.state.data?.total ?? 0} requests
              </StatusBadge>
              <Button onClick={requests.reload} size="sm" variant="ghost">
                새로 고침
              </Button>
            </>
          }
          title="요청 목록"
        >
          <RequestsFilters
            draft={draft}
            onApply={applyFilters}
            onChange={setDraft}
          />
          <RequestsListBody
            clockAnchor={clockAnchor}
            onSelect={selectRequest}
            onSort={applySort}
            query={query}
            requests={requests}
            selectedRequestId={selectedRequestId}
            setQuery={setQuery}
          />
        </Panel>

        <div className="requests-detail-desktop detail-aside">
          <RequestDetailPanel
            detailState={detail.state}
            emptyDescription="목록에서 요청을 선택하면 상세 정보가 표시됩니다."
            emptyTitle="선택된 요청이 없습니다"
            onRetry={detail.reload}
          />
        </div>

        <div className="requests-detail-compact">
          <Drawer
            description={
              selectedRequest?.path ?? selectedRequestId ?? undefined
            }
            onOpenChange={setDrawerOpen}
            open={drawerOpen}
            title="요청 상세"
            trigger={
              <Button disabled={!selectedRequestId} size="sm" variant="ghost">
                상세 보기
              </Button>
            }
          >
            <RequestDetailPanel
              detailState={detail.state}
              emptyDescription="목록에서 요청을 선택하면 상세 정보가 표시됩니다."
              emptyTitle="선택된 요청이 없습니다"
              onRetry={detail.reload}
            />
          </Drawer>
        </div>
      </section>
    </div>
  );
}

function RequestsFilters({
  draft,
  onApply,
  onChange,
}: {
  draft: RequestsDraft;
  onApply: () => void;
  onChange: (draft: RequestsDraft) => void;
}) {
  return (
    <form
      className="requests-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <label>
        <span>검색</span>
        <input
          onChange={(event) => onChange({ ...draft, q: event.target.value })}
          placeholder="경로, 상태, 라이브러리"
          type="search"
          value={draft.q}
        />
      </label>
      <label>
        <span>상태</span>
        <select
          onChange={(event) =>
            onChange({
              ...draft,
              status: event.target.value as RequestsDraft["status"],
            })
          }
          value={draft.status}
        >
          <option value="">전체</option>
          {REQUEST_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Method</span>
        <input
          onChange={(event) =>
            onChange({ ...draft, method: event.target.value })
          }
          placeholder="GET"
          value={draft.method}
        />
      </label>
      <label>
        <span>경로</span>
        <input
          onChange={(event) => onChange({ ...draft, path: event.target.value })}
          placeholder="/demo"
          value={draft.path}
        />
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

function RequestsListBody({
  clockAnchor,
  onSelect,
  onSort,
  query,
  requests,
  selectedRequestId,
  setQuery,
}: {
  clockAnchor: ClockAnchor | null;
  onSelect: (requestId: string) => void;
  onSort: (sort: RequestSort, order: RequestOrder) => void;
  query: RequestsQuery;
  requests: ReturnType<typeof useRequests>;
  selectedRequestId: string | null;
  setQuery: (query: RequestsQuery) => void;
}) {
  if (requests.state.state === "loading") {
    return (
      <div className="panel__state" aria-busy="true">
        <span className="skeleton" />
        <span className="skeleton" style={{ inlineSize: "72%" }} />
        <span>요청 목록을 불러오는 중입니다.</span>
      </div>
    );
  }

  if (requests.state.state === "error") {
    return (
      <EmptyState
        description={requests.state.error}
        title="요청 목록을 불러오지 못했습니다"
      />
    );
  }

  return (
    <div className="requests-list">
      {requests.state.state === "empty" ? (
        <EmptyState
          description="검색어를 지우거나, 앱에 요청을 보낸 뒤 다시 확인해 보세요."
          title="조건에 맞는 요청이 없습니다"
        />
      ) : (
        <RequestsTable
          clockAnchor={clockAnchor}
          onSelect={onSelect}
          onSort={onSort}
          order={query.order}
          requests={requests.state.data.items}
          selectedRequestId={selectedRequestId}
          sort={query.sort}
        />
      )}
      <PaginationControls
        hasNext={requests.state.data.has_next}
        page={requests.state.data.page}
        pageSize={requests.state.data.page_size}
        setPage={(page) => setQuery({ ...query, page })}
        total={requests.state.data.total}
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

function draftFromQuery(query: RequestsQuery): RequestsDraft {
  return {
    method: query.method ?? "",
    page_size: query.page_size,
    path: query.path ?? "",
    q: query.q ?? "",
    status: query.status ?? "",
  };
}

function requestIdFromHash() {
  const query = window.location.hash.split("?")[1] ?? "";
  return new URLSearchParams(query).get("request_id");
}

function setRequestIdHash(requestId: string) {
  const params = new URLSearchParams({ request_id: requestId });
  window.location.hash = `/requests?${params}`;
}
