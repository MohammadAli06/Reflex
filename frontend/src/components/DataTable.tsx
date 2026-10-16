import type { ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  render?: (row: T) => ReactNode
}

export function DataTable<T>({
  columns,
  rows,
  emptyMessage = 'No data',
  rowClassName,
}: {
  columns: Column<T>[]
  rows: T[]
  emptyMessage?: string
  rowClassName?: (row: T) => string
}) {
  if (rows.length === 0) {
    return <div className="state state-empty">{emptyMessage}</div>
  }
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={rowClassName?.(row)}>
              {columns.map((column) => (
                <td key={column.key}>
                  {column.render ? column.render(row) : String((row as Record<string, unknown>)[column.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
