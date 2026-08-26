import { type ClockAnchor, formatWallClock } from "../../shared/api/eventStore";
import type {
  RequestOrder,
  RequestSort,
  RequestSummary,
} from "../../shared/api/schemas";
import { StatusBadge, Table, type TableColumn } from "../../shared/ui";
import { formatDuration } from "../timeline/timeline";

type RequestsTableProps = {
  clockAnchor: ClockAnchor | null;
  onSelect: (requestId: string) => void;
  onSort: (sort: RequestSort, order: RequestOrder) => void;
  order: RequestOrder;
  requests: RequestSummary[];
  selectedRequestId: string | null;
  sort: RequestSort;
};

export function RequestsTable({
  clockAnchor,
  onSelect,
  onSort,
  order,
  requests,
  selectedRequestId,
  sort,
}: RequestsTableProps) {
  const columns: Array<TableColumn<RequestSummary>> = [
    {
      key: "request",
      header: "요청",
      headerAlign: "center",
      width: "220px",
      sortKey: "path",
      render: (request) => (
        <button
          className="requests-table__select"
          onClick={() => onSelect(request.request_id)}
          type="button"
        >
          <span className="requests-table__method">
            {request.method ?? "GET"}
          </span>
          <span className="truncate" title={request.path ?? ""}>
            {request.path ?? request.request_id}
          </span>
        </button>
      ),
    },
    {
      key: "status",
      header: "상태",
      headerAlign: "center",
      width: "112px",
      sortKey: "status",
      render: (request) => (
        <StatusBadge
          icon={statusIcon(request.status)}
          tone={statusTone(request.status)}
        >
          {request.status}
        </StatusBadge>
      ),
    },
    {
      key: "duration",
      header: "소요 시간",
      headerAlign: "center",
      width: "112px",
      numeric: true,
      sortKey: "duration_ns",
      render: (request) => formatDuration(request.duration_ns),
    },
    {
      key: "started",
      header: "시작 시각",
      headerAlign: "center",
      width: "148px",
      numeric: true,
      sortKey: "started_at_ns",
      render: (request) => formatWallClock(request.started_at_ns, clockAnchor),
    },
    {
      key: "events",
      header: "이벤트",
      headerAlign: "center",
      width: "84px",
      numeric: true,
      render: (request) => request.event_count,
    },
    {
      key: "flags",
      header: "특이 사항",
      headerAlign: "center",
      width: "156px",
      render: (request) => <Flags request={request} />,
    },
  ];

  return (
    <Table
      caption="요청 목록"
      className="requests-table-wrap"
      columns={columns}
      emptyMessage="표시할 요청이 없습니다."
      getRowId={(request) => request.request_id}
      rows={requests}
      selectedId={selectedRequestId ?? undefined}
      sort={{
        key: sort,
        order,
        onChange: (key, nextOrder) => onSort(key as RequestSort, nextOrder),
      }}
    />
  );
}

function Flags({ request }: { request: RequestSummary }) {
  if (!request.has_blocking && !request.has_unknown_await) {
    return <span className="field-help">없음</span>;
  }
  return (
    <div className="cluster">
      {request.has_blocking ? (
        <StatusBadge icon="!" tone="error">
          blocking
        </StatusBadge>
      ) : null}
      {request.has_unknown_await ? (
        <StatusBadge icon="△" tone="inferred">
          unknown
        </StatusBadge>
      ) : null}
    </div>
  );
}

function statusTone(status: RequestSummary["status"]) {
  if (status === "completed") {
    return "success";
  }
  if (status === "running") {
    return "observed";
  }
  return "error";
}

function statusIcon(status: RequestSummary["status"]) {
  if (status === "completed") {
    return "✓";
  }
  if (status === "running") {
    return "●";
  }
  return "!";
}
