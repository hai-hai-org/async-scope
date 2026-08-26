import type { FindingPayload } from "../../shared/api/schemas";
import { StatusBadge } from "../../shared/ui";
import { formatDuration, formatTimestamp } from "../timeline/timeline";

type FindingsTableProps = {
  findings: FindingPayload[];
  onSelect: (findingId: string) => void;
  selectedFindingId: string | null;
};

export function FindingsTable({
  findings,
  onSelect,
  selectedFindingId,
}: FindingsTableProps) {
  return (
    <section
      aria-label="문제 목록 스크롤 영역"
      className="table-wrap analyzer-table-wrap"
    >
      <table className="table analyzer-table">
        <caption className="sr-only">발견된 문제</caption>
        <thead>
          <tr>
            <th scope="col">문제</th>
            <th scope="col">심각도</th>
            <th scope="col">근거</th>
            <th scope="col">지속 시간</th>
            <th scope="col">감지 시각</th>
            <th scope="col">피드백</th>
          </tr>
        </thead>
        <tbody>
          {findings.length === 0 ? (
            <tr>
              <td colSpan={6}>표시할 문제가 없습니다.</td>
            </tr>
          ) : (
            findings.map((finding) => (
              <tr
                aria-selected={selectedFindingId === finding.finding_id}
                key={finding.finding_id}
              >
                <td>
                  <button
                    className="analyzer-table__select"
                    onClick={() => onSelect(finding.finding_id)}
                    type="button"
                  >
                    <span className="mono">{finding.type}</span>
                    <span className="truncate" title={finding.title}>
                      {finding.title}
                    </span>
                  </button>
                </td>
                <td>
                  <StatusBadge
                    icon={severityIcon(finding.severity)}
                    tone={severityTone(finding.severity)}
                  >
                    {finding.severity}
                  </StatusBadge>
                </td>
                <td>
                  <StatusBadge
                    icon={finding.evidence === "observed" ? "●" : "△"}
                    tone={
                      finding.evidence === "observed" ? "observed" : "inferred"
                    }
                  >
                    {finding.evidence}
                  </StatusBadge>
                </td>
                <td>{formatDuration(finding.duration_ns)}</td>
                <td>{formatTimestamp(finding.detected_at_ns)}</td>
                <td>
                  <div className="cluster">
                    {finding.feedback.acknowledged ? (
                      <StatusBadge icon="✓" tone="success">
                        ack
                      </StatusBadge>
                    ) : null}
                    {finding.feedback.false_positive ? (
                      <StatusBadge icon="!" tone="inferred">
                        false positive
                      </StatusBadge>
                    ) : null}
                    {!finding.feedback.acknowledged &&
                    !finding.feedback.false_positive ? (
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

export function severityTone(severity: FindingPayload["severity"]) {
  if (severity === "high") {
    return "error";
  }
  if (severity === "medium") {
    return "warning";
  }
  return "observed";
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
