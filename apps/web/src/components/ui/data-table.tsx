'use client'

import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import type {
  Column,
  ColumnDef,
  ColumnFiltersState,
  ExpandedState,
  FilterFn,
  OnChangeFn,
  Row,
  SortingState,
  Table as TanstackTable,
} from '@tanstack/react-table'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

// Column filter for a DataTableFilter chip: the filter value is the set of
// option values the organizer picked, and a row passes when its cell value
// is one of them. An empty or missing set passes every row.
export const oneOfFilter: FilterFn<any> = (row, columnId, filterValue) => {
  if (!Array.isArray(filterValue) || filterValue.length === 0) {
    return true
  }
  return filterValue.includes(row.getValue(columnId))
}

// Inclusive epoch-ms bounds for a DataTableDateRangeFilter chip. Either end
// may be open; `to` is the last instant of its day, so a same-day range
// still matches events that afternoon.
export type DateRangeFilterValue = { from?: number; to?: number }

// Column filter for a date range chip: the cell value is an epoch-ms
// timestamp, and a row passes when it falls inside the picked range.
export const dateRangeFilter: FilterFn<any> = (row, columnId, filterValue) => {
  const range = filterValue as DateRangeFilterValue | undefined
  if (!range || (range.from === undefined && range.to === undefined)) {
    return true
  }
  const value = row.getValue<number>(columnId)
  if (range.from !== undefined && value < range.from) {
    return false
  }
  if (range.to !== undefined && value > range.to) {
    return false
  }
  return true
}

// Columns may align their header and cells (e.g. `text-right`) by setting
// `meta: { className }` on the column definition.
type DataTableColumnMeta = { className?: string }

function columnClassName(meta: unknown): string | undefined {
  return (meta as DataTableColumnMeta | undefined)?.className
}

interface DataTableProps<TData, TValue> {
  columns: Array<ColumnDef<TData, TValue>>
  data: Array<TData>
  className?: string
  pageSize?: number
  pageSizeOptions?: Array<number>
  noResultsLabel?: React.ReactNode
  onRowClick?: (row: TData) => void
  toolbar?: (table: TanstackTable<TData>) => React.ReactNode
  // Column filters applied on first render (e.g. a Status chip preset to
  // active states). The table owns the state afterwards.
  initialColumnFilters?: ColumnFiltersState
  // Controlled column filters, for callers that keep them somewhere durable
  // such as the route's search params. Pass both or neither.
  columnFilters?: ColumnFiltersState
  onColumnFiltersChange?: OnChangeFn<ColumnFiltersState>
  // Stable row identity; defaults to the row index, which reshuffles the
  // expanded/selected state whenever data reorders.
  getRowId?: (row: TData) => string
  // Nested rows: a parent's children render indented beneath it and can be
  // collapsed with `row.getToggleExpandedHandler()`. Every parent starts
  // expanded, and a search that matches a child keeps its parent visible.
  getSubRows?: (row: TData) => Array<TData> | undefined
  rowClassName?: (row: Row<TData>) => string | undefined
}

export function DataTable<TData, TValue>({
  columns,
  data,
  className,
  pageSize = 25,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  noResultsLabel = 'No results.',
  onRowClick,
  toolbar,
  initialColumnFilters = [],
  columnFilters: controlledColumnFilters,
  onColumnFiltersChange,
  getRowId,
  getSubRows,
  rowClassName,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [internalColumnFilters, setInternalColumnFilters] =
    React.useState<ColumnFiltersState>(initialColumnFilters)
  const columnFilters = controlledColumnFilters ?? internalColumnFilters
  const setColumnFilters = onColumnFiltersChange ?? setInternalColumnFilters
  const [expanded, setExpanded] = React.useState<ExpandedState>(true)

  const table = useReactTable({
    data,
    columns,
    getRowId,
    getSubRows,
    filterFromLeafRows: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onExpandedChange: setExpanded,
    initialState: { pagination: { pageSize } },
    state: { sorting, columnFilters, expanded },
  })

  const rows = table.getRowModel().rows
  const pageCount = table.getPageCount()
  const currentPageSize = table.getState().pagination.pageSize
  // Only surface pagination controls once there are more rows than the smallest
  // page size — small tables shouldn't carry an empty footer.
  const showFooter = data.length > pageSizeOptions[0]

  return (
    <div className="flex flex-col gap-4">
      {toolbar ? toolbar(table) : null}

      <Table className={className}>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead
                  key={header.id}
                  className={columnClassName(header.column.columnDef.meta)}
                >
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                {noResultsLabel}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(
                  onRowClick && 'cursor-pointer',
                  rowClassName?.(row),
                )}
                onClick={
                  onRowClick ? () => onRowClick(row.original) : undefined
                }
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={columnClassName(cell.column.columnDef.meta)}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {showFooter ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">Rows per page</p>
            <Select
              value={String(currentPageSize)}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger
                size="sm"
                className="w-16"
                aria-label="Rows per page"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {pageCount > 1 ? (
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground tabular-nums">
                Page {table.getState().pagination.pageIndex + 1} of {pageCount}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: {
  column: Column<TData, TValue>
  title: string
  className?: string
}) {
  if (!column.getCanSort()) {
    return <span className={className}>{title}</span>
  }

  const sorted = column.getIsSorted()

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={cn('-ml-2 h-8', className)}
      onClick={() => column.toggleSorting(sorted === 'asc')}
    >
      {title}
      {sorted === 'asc' ? (
        <ArrowUp data-icon="inline-end" />
      ) : sorted === 'desc' ? (
        <ArrowDown data-icon="inline-end" />
      ) : (
        <ChevronsUpDown data-icon="inline-end" />
      )}
    </Button>
  )
}
