import type { FindingPayload } from "../../shared/api/schemas";
import { StatusBadge, Table, type TableColumn } from "../../shared/ui";
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
  // sort prop을 넘기지 않는다 — FindingsQuery에 sort 파라미터가 없어서
  // 현재 페이지만 정렬하면 서버 pagination과 어긋난다.
  const columns: Array<TableColumn<FindingPayload>> = [
    {
      key: "finding",
      header: "문제",
      render: (finding) => (
        <button
          className="analyzer-table__select"
          onClick={() => onSelect(finding.finding_id)}
          type="button"
        >
          <span className="analyzer-table__type">{finding.type}</span>
          <span className="truncate" title={finding.title}>
            {finding.title}
          </span>
        </button>
      ),
    },
    {
      key: "severity",
      header: "심각도",
      width: "124px",
      render: (finding) => (
        <StatusBadge
          icon={severityIcon(finding.severity)}
          tone={severityTone(finding.severity)}
        >
          {finding.severity}
        </StatusBadge>
      ),
    },
    {
      key: "evidence",
      header: "근거",
      width: "120px",
      render: (finding) => (
        <StatusBadge
          icon={finding.evidence === "observed" ? "●" : "△"}
          tone={finding.evidence === "observed" ? "observed" : "inferred"}
        >
          {finding.evidence}
        </StatusBadge>
      ),
    },
    {
      key: "duration",
      header: "지속 시간",
      width: "112px",
      align: "end",
      numeric: true,
      render: (finding) => formatDuration(finding.duration_ns),
    },
    {
      key: "detected",
      header: "감지 시각",
      width: "148px",
      align: "end",
      numeric: true,
      render: (finding) => formatTimestamp(finding.detected_at_ns),
    },
    {
      key: "feedback",
      header: "피드백",
      width: "148px",
      render: (finding) => <Feedback finding={finding} />,
    },
  ];

  return (
    <Table
      caption="발견된 문제"
      columns={columns}
      emptyMessage="표시할 문제가 없습니다."
      getRowId={(finding) => finding.finding_id}
      rows={findings}
      selectedId={selectedFindingId ?? undefined}
    />
  );
}

function Feedback({ finding }: { finding: FindingPayload }) {
  if (!finding.feedback.acknowledged && !finding.feedback.false_positive) {
    return <span className="field-help">없음</span>;
  }
  return (
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
    </div>
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
