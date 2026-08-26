import { useEffect, useMemo, useState } from "react";
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

type RequestsDraft = {
  method: string;
  order: RequestOrder;
  page_size: number;
  path: string;
  q: string;
  sort: RequestSort;
  status: "" | RequestStatus;
};

const REQUEST_STATUSES: RequestStatus[] = [
  "running",
  "completed",
  "failed",
  "cancelled",
  "disconnected",
];

export function RequestsPage() {
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
      order: draft.order,
      page: 1,
      page_size: draft.page_size,
      sort: draft.sort,
      ...(draft.q ? { q: draft.q } : {}),
      ...(draft.status ? { status: draft.status } : {}),
      ...(draft.method ? { method: draft.method.toUpperCase() } : {}),
      ...(draft.path ? { path: draft.path } : {}),
    });
  };
  const selectRequest = (requestId: string) => {
    setSelectedRequestId(requestId);
    setDrawerOpen(true);
    setRequestIdHash(requestId);
  };

  return (
    <div className="dashboard-page requests-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Issue #65</p>
          <h2>Requests</h2>
          <p>
            request list에서 검색·filter·sort·pagination으로 대상을 찾고, 같은
            request detail flow로 span과 source를 탐색한다.
          </p>
        </div>
        <StatusBadge icon="R" tone="observed">
          {requests.state.data?.total ?? 0} requests
        </StatusBadge>
      </section>

      <section className="requests-layout">
        <Panel
          actions={
            <Button onClick={requests.reload} size="sm" variant="ghost">
              Refresh
            </Button>
          }
          description="내부 API의 query contract를 그대로 사용한다."
          title="Request list"
        >
          <RequestsFilters
            draft={draft}
            onApply={applyFilters}
            onChange={setDraft}
          />
          <RequestsListBody
            onSelect={selectRequest}
            query={query}
            requests={requests}
            selectedRequestId={selectedRequestId}
            setQuery={setQuery}
          />
        </Panel>

        <div className="requests-detail-desktop">
          <RequestDetailPanel
            detailState={detail.state}
            emptyDescription="Requests table에서 row를 선택하면 detail을 표시한다."
            emptyTitle="선택된 request 없음"
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
            title="Request detail"
            trigger={
              <Button disabled={!selectedRequestId} size="sm" variant="ghost">
                Detail 열기
              </Button>
            }
          >
            <RequestDetailPanel
              detailState={detail.state}
              emptyDescription="Requests table에서 row를 선택하면 detail을 표시한다."
              emptyTitle="선택된 request 없음"
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
        <span>Search</span>
        <input
          onChange={(event) => onChange({ ...draft, q: event.target.value })}
          placeholder="path, status, library"
          type="search"
          value={draft.q}
        />
      </label>
      <label>
        <span>Status</span>
        <select
          onChange={(event) =>
            onChange({
              ...draft,
              status: event.target.value as RequestsDraft["status"],
            })
          }
          value={draft.status}
        >
          <option value="">all</option>
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
        <span>Path</span>
        <input
          onChange={(event) => onChange({ ...draft, path: event.target.value })}
          placeholder="/demo"
          value={draft.path}
        />
      </label>
      <label>
        <span>Sort</span>
        <select
          onChange={(event) =>
            onChange({ ...draft, sort: event.target.value as RequestSort })
          }
          value={draft.sort}
        >
          <option value="started_at_ns">started</option>
          <option value="duration_ns">duration</option>
          <option value="status">status</option>
          <option value="path">path</option>
        </select>
      </label>
      <label>
        <span>Order</span>
        <select
          onChange={(event) =>
            onChange({ ...draft, order: event.target.value as RequestOrder })
          }
          value={draft.order}
        >
          <option value="desc">desc</option>
          <option value="asc">asc</option>
        </select>
      </label>
      <label>
        <span>Page size</span>
        <select
          onChange={(event) =>
            onChange({ ...draft, page_size: Number(event.target.value) })
          }
          value={draft.page_size}
        >
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>
      </label>
      <Button size="sm" type="submit" variant="primary">
        Apply
      </Button>
    </form>
  );
}

function RequestsListBody({
  onSelect,
  query,
  requests,
  selectedRequestId,
  setQuery,
}: {
  onSelect: (requestId: string) => void;
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
        <span>request 목록을 불러오는 중</span>
      </div>
    );
  }

  if (requests.state.state === "error") {
    return (
      <EmptyState
        description={requests.state.error}
        title="Request list unavailable"
      />
    );
  }

  return (
    <div className="requests-list">
      {requests.state.state === "empty" ? (
        <EmptyState
          description="검색어나 filter를 완화하거나 app request를 먼저 실행해야 한다."
          title="검색 결과 없음"
        />
      ) : (
        <RequestsTable
          onSelect={onSelect}
          requests={requests.state.data.items}
          selectedRequestId={selectedRequestId}
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
          Previous
        </Button>
        <Button
          disabled={!hasNext}
          onClick={() => setPage(page + 1)}
          size="sm"
          variant="ghost"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

function draftFromQuery(query: RequestsQuery): RequestsDraft {
  return {
    method: query.method ?? "",
    order: query.order,
    page_size: query.page_size,
    path: query.path ?? "",
    q: query.q ?? "",
    sort: query.sort,
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
