import type { ReactNode } from "react";

export type TableColumn<T> = {
  header: string;
  key: string;
  render: (row: T) => ReactNode;
  /** table-layout: fixed의 열 폭. 지정하지 않으면 남은 폭을 나눠 갖는다. */
  width?: string;
  /** 값 열의 정렬. 숫자 열은 오른쪽 정렬해야 자릿수가 맞는다. */
  align?: "start" | "end";
  /** 제목 열의 정렬. 지정하지 않으면 align을 따른다(기존 표들의 동작 유지). */
  headerAlign?: "start" | "center" | "end";
  /** tabular-nums로 폭을 고정한다. stream 갱신 중 숫자가 흔들리지 않게 한다. */
  numeric?: boolean;
  /** 지정하면 헤더가 정렬 버튼이 된다. sort prop이 함께 있어야 동작한다. */
  sortKey?: string;
};

export type TableSort<K extends string = string> = {
  key: K;
  order: "asc" | "desc";
  onChange: (key: K, order: "asc" | "desc") => void;
};

type TableProps<T> = {
  caption: string;
  className?: string;
  columns: Array<TableColumn<T>>;
  emptyMessage?: string;
  getRowId: (row: T) => string;
  rows: T[];
  selectedId?: string;
  /**
   * 서버 정렬 상태. 없으면 헤더는 평범한 텍스트로 렌더링한다.
   * 백엔드가 정렬을 지원하지 않는 목록(Analyzer)에서 현재 페이지만
   * 정렬하면 pagination과 어긋나 사용자를 오해시키므로 만들지 않는다.
   */
  sort?: TableSort;
};

export function Table<T>({
  caption,
  className,
  columns,
  emptyMessage = "표시할 항목이 없습니다.",
  getRowId,
  rows,
  selectedId,
  sort,
}: TableProps<T>) {
  return (
    <section
      aria-label={`${caption} 스크롤 영역`}
      className={["table-wrap", className].filter(Boolean).join(" ")}
    >
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <HeaderCell column={column} key={column.key} sort={sort} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{emptyMessage}</td>
            </tr>
          ) : (
            rows.map((row) => {
              const rowId = getRowId(row);
              return (
                <tr aria-selected={selectedId === rowId} key={rowId}>
                  {columns.map((column) => (
                    <td
                      className={cellClass(column)}
                      key={column.key}
                      style={
                        column.align ? { textAlign: column.align } : undefined
                      }
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </section>
  );
}

function HeaderCell<T>({
  column,
  sort,
}: {
  column: TableColumn<T>;
  sort?: TableSort;
}) {
  const sortable = Boolean(column.sortKey && sort);
  const active = sortable && sort?.key === column.sortKey;
  const ariaSort = active
    ? sort?.order === "asc"
      ? "ascending"
      : "descending"
    : undefined;
  const headerAlign = column.headerAlign ?? column.align;

  return (
    <th
      aria-sort={sortable ? (ariaSort ?? "none") : undefined}
      className={cellClass(column)}
      scope="col"
      style={headerAlign ? { textAlign: headerAlign } : undefined}
    >
      {sortable ? (
        <button
          className="table__sort"
          onClick={() => {
            // 같은 열을 다시 누르면 방향만 뒤집는다.
            const nextOrder = active && sort?.order === "desc" ? "asc" : "desc";
            sort?.onChange(column.sortKey as string, nextOrder);
          }}
          type="button"
        >
          <span>{column.header}</span>
          <span aria-hidden="true" className="table__sort-arrow">
            {active ? (sort?.order === "asc" ? "▲" : "▼") : "↕"}
          </span>
        </button>
      ) : (
        column.header
      )}
    </th>
  );
}

function cellClass<T>(column: TableColumn<T>) {
  return column.numeric ? "table__cell--numeric" : undefined;
}
