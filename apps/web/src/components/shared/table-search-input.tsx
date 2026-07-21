import type { Table } from '@tanstack/react-table'

import { Input } from '@/components/ui/input'

export function TableSearchInput<TData>({
  table,
  columnId,
  placeholder,
}: {
  table: Table<TData>
  columnId: string
  placeholder: string
}) {
  const column = table.getColumn(columnId)

  return (
    <Input
      aria-label={placeholder}
      placeholder={placeholder}
      value={String(column?.getFilterValue() ?? '')}
      onChange={(event) => column?.setFilterValue(event.target.value)}
      className="max-w-xs"
    />
  )
}
