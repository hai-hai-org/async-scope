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
      aria-label="Requests table scroll area"
      className="table-wrap requests-table-wrap"
    >
      <table className="table requests-table">
        <caption>Requests</caption>
        <thead>
          <tr>
            <th scope="col">Request</th>
            <th scope="col">Status</th>
            <th scope="col">Duration</th>
            <th scope="col">Started</th>
            <th scope="col">Events</th>
            <th scope="col">Flags</th>
          </tr>
        </thead>
        <tbody>
          {requests.length === 0 ? (
            <tr>
              <td colSpan={6}>표시할 request가 없습니다.</td>
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
                      <span className="field-help">none</span>
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
