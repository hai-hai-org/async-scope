import type { RequestSummary } from "../../shared/api/schemas";
import { StatusBadge } from "../../shared/ui";
import { formatDuration, formatTimestamp } from "../timeline/timeline";

type RequestsTableProps = {
  onSelect: (requestId: string) => void;
  requests: RequestSummary[];
  selectedRequestId: string | null;
};

export function RequestsTable({
  onSelect,
  requests,
  selectedRequestId,
}: RequestsTableProps) {
  return (
    <section
      aria-label="요청 목록 스크롤 영역"
      className="table-wrap requests-table-wrap"
    >
      <table className="table requests-table">
        <caption className="sr-only">요청 목록</caption>
        <thead>
          <tr>
            <th scope="col">요청</th>
            <th scope="col">상태</th>
            <th scope="col">소요 시간</th>
            <th scope="col">시작 시각</th>
            <th scope="col">이벤트</th>
            <th scope="col">특이 사항</th>
          </tr>
        </thead>
        <tbody>
          {requests.length === 0 ? (
            <tr>
              <td colSpan={6}>표시할 요청이 없습니다.</td>
            </tr>
          ) : (
            requests.map((request) => (
              <tr
                aria-selected={selectedRequestId === request.request_id}
                key={request.request_id}
              >
                <td>
                  <button
                    className="requests-table__select"
                    onClick={() => onSelect(request.request_id)}
                    type="button"
                  >
                    <span className="mono">{request.method ?? "GET"}</span>
                    <span className="truncate" title={request.path ?? ""}>
                      {request.path ?? request.request_id}
                    </span>
                  </button>
                </td>
                <td>
                  <StatusBadge
                    icon={statusIcon(request.status)}
                    tone={statusTone(request.status)}
                  >
                    {request.status}
                  </StatusBadge>
                </td>
                <td>{formatDuration(request.duration_ns)}</td>
                <td>{formatTimestamp(request.started_at_ns)}</td>
                <td>{request.event_count}</td>
                <td>
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
                    {!request.has_blocking && !request.has_unknown_await ? (
                      <span className="field-help">없음</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
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
