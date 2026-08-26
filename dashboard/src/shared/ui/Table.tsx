import type { ReactNode } from "react";

export type TableColumn<T> = {
  header: string;
  key: string;
  render: (row: T) => ReactNode;
};

type TableProps<T> = {
  caption: string;
  columns: Array<TableColumn<T>>;
  emptyMessage?: string;
  getRowId: (row: T) => string;
  rows: T[];
  selectedId?: string;
};

export function Table<T>({
  caption,
  columns,
  emptyMessage = "표시할 항목이 없습니다.",
  getRowId,
  rows,
  selectedId,
}: TableProps<T>) {
  return (
    <section aria-label={`${caption} table scroll area`} className="table-wrap">
      <table className="table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
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
                    <td key={column.key}>{column.render(row)}</td>
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
