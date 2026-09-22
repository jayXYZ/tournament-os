'use client'

import * as React from 'react'
import { CalendarDays, Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import type { Column } from '@tanstack/react-table'
import type { LucideIcon } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import type { DateRangeFilterValue } from '@/components/ui/data-table'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

// The row above a table: search on the left, one chip per filter, an
// overflow menu for filters that only matter sometimes, and the table's own
// actions pinned to the right. A filter holds either a set of option values
// or a date range; each chip reads "+ Label" until it has a value and then
// names what it holds.

export type DataTableFilterOption = {
  value: string
  label: string
  // A semantic dot beside the label (a `bg-*` class), for status-like options.
  dotClassName?: string
}

type DataTableFilterBase = {
  id: string
  label: string
  icon?: LucideIcon
  // Secondary filters live under "More filters" until picked or non-empty.
  secondary?: boolean
  // Bind to a TanStack column, or control the value directly.
  column?: Column<any, unknown>
}

// A checkbox list; the column's filter value is the selected option values
// (see `oneOfFilter` in data-table.tsx).
export type DataTableOptionsFilterDef = DataTableFilterBase & {
  kind?: 'options'
  options: Array<DataTableFilterOption>
  value?: Array<string>
  onChange?: (value: Array<string>) => void
}

// A calendar range; the column's filter value is inclusive epoch-ms bounds
// (see `dateRangeFilter` in data-table.tsx).
export type DataTableDateRangeFilterDef = DataTableFilterBase & {
  kind: 'dateRange'
  value?: DateRangeFilterValue
  onChange?: (value: DateRangeFilterValue | undefined) => void
}

export type DataTableFilterDef =
  | DataTableOptionsFilterDef
  | DataTableDateRangeFilterDef

// Toolbar `search` bound to a TanStack column's string filter, for tables
// whose search narrows the rows already on the client.
export function columnSearch(
  column: Column<any, unknown> | undefined,
  placeholder: string,
) {
  return {
    value: String(column?.getFilterValue() ?? ''),
    onChange: (value: string) =>
      column?.setFilterValue(value === '' ? undefined : value),
    placeholder,
  }
}

export function DataTableToolbar({
  search,
  filters = [],
  actions,
  className,
}: {
  search?: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    label?: string
  }
  filters?: Array<DataTableFilterDef>
  actions?: React.ReactNode
  className?: string
}) {
  const [revealed, setRevealed] = React.useState<Set<string>>(() => new Set())
  const [openId, setOpenId] = React.useState<string | null>(null)

  const visible = filters.filter(
    (filter) =>
      !filter.secondary || revealed.has(filter.id) || hasFilterValue(filter),
  )
  const hidden = filters.filter((filter) => !visible.includes(filter))

  function reveal(id: string) {
    setRevealed((current) => new Set(current).add(id))
    setOpenId(id)
  }

  return (
    <div
      data-slot="data-table-toolbar"
      className={cn('flex flex-wrap items-center gap-2', className)}
    >
      {search ? (
        <InputGroup className="w-full sm:max-w-xs">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label={search.label ?? search.placeholder ?? 'Search'}
            placeholder={search.placeholder ?? 'Search'}
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
          />
        </InputGroup>
      ) : null}

      {visible.map((filter) =>
        filter.kind === 'dateRange' ? (
          <DataTableDateRangeFilter
            key={filter.id}
            filter={filter}
            open={openId === filter.id}
            onOpenChange={(open) => setOpenId(open ? filter.id : null)}
          />
        ) : (
          <DataTableFilter
            key={filter.id}
            filter={filter}
            open={openId === filter.id}
            onOpenChange={(open) => setOpenId(open ? filter.id : null)}
          />
        ),
      )}

      {hidden.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline">
              <SlidersHorizontal data-icon="inline-start" />
              More filters
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {hidden.map((filter) => (
              <DropdownMenuItem
                key={filter.id}
                onSelect={() => reveal(filter.id)}
              >
                {filter.icon ? <filter.icon /> : null}
                {filter.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      {actions ? (
        <div className="ml-auto flex items-center gap-2">{actions}</div>
      ) : null}
    </div>
  )
}

function hasFilterValue(filter: DataTableFilterDef) {
  if (filter.kind === 'dateRange') {
    const range = readDateRange(filter)
    return range.from !== undefined || range.to !== undefined
  }
  return readFilterValue(filter).length > 0
}

function readFilterValue(filter: DataTableOptionsFilterDef): Array<string> {
  if (filter.column) {
    const value = filter.column.getFilterValue()
    return Array.isArray(value) ? (value as Array<string>) : []
  }
  return filter.value ?? []
}

function writeFilterValue(
  filter: DataTableOptionsFilterDef,
  value: Array<string>,
) {
  if (filter.column) {
    filter.column.setFilterValue(value.length > 0 ? value : undefined)
  }
  filter.onChange?.(value)
}

function readDateRange(
  filter: DataTableDateRangeFilterDef,
): DateRangeFilterValue {
  if (filter.column) {
    return (
      (filter.column.getFilterValue() as DateRangeFilterValue | undefined) ?? {}
    )
  }
  return filter.value ?? {}
}

function writeDateRange(
  filter: DataTableDateRangeFilterDef,
  value: DateRangeFilterValue | undefined,
) {
  const next =
    value && (value.from !== undefined || value.to !== undefined)
      ? value
      : undefined
  if (filter.column) {
    filter.column.setFilterValue(next)
  }
  filter.onChange?.(next)
}

// The chip itself: a trigger that names the filter and, once it holds a
// value, what it holds. The leading "+" turns into an "×" (a quarter turn,
// animated) that clears the filter; it is a sibling button laid over the
// icon so the chip stays one pill without nesting buttons.
function FilterChip({
  filter,
  summary,
  onClear,
  open,
  onOpenChange,
  contentClassName,
  children,
}: {
  filter: DataTableFilterDef
  summary: string | null
  onClear: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  contentClassName?: string
  children: React.ReactNode
}) {
  const active = summary !== null
  const IdleIcon =
    filter.icon ?? (filter.kind === 'dateRange' ? CalendarDays : Plus)
  // A plus rotated a quarter turn is an ×, so the default icon animates into
  // the clear affordance; a bespoke icon has no such trick and swaps for X.
  const rotates = IdleIcon === Plus
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div className="relative inline-flex items-center">
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={
              active
                ? `${filter.label}: ${summary}`
                : `Filter by ${filter.label.toLowerCase()}`
            }
            className="pl-1"
          >
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center"
            >
              {rotates || !active ? (
                <IdleIcon
                  className={cn(
                    'size-3.5 transition-transform duration-200 ease-out',
                    active && 'rotate-45',
                  )}
                />
              ) : (
                <X className="size-3.5" />
              )}
            </span>
            {filter.label}
            {active ? ':' : null}
            {active ? (
              <span className="max-w-48 truncate font-normal text-accent-brand">
                {summary}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        {/* Sits exactly over the icon circle: the trigger's 1px border plus
            its pl-1. The circle only shows on hover or focus, so at rest the
            × reads as part of the chip. */}
        {active ? (
          <button
            type="button"
            aria-label={`Clear ${filter.label.toLowerCase()} filter`}
            onClick={onClear}
            className="absolute top-1/2 left-[calc(--spacing(1)+1px)] size-5 -translate-y-1/2 rounded-full outline-none transition-colors duration-200 hover:bg-muted-foreground/20 focus-visible:bg-muted-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50"
          />
        ) : null}
      </div>
      <PopoverContent
        align="start"
        className={cn('gap-0 p-1', contentClassName)}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

// The chip names its first two picks and counts the rest, so a wide preset
// (say, three active statuses) stays legible instead of truncating mid-word.
function summarizeSelection(labels: Array<string>) {
  if (labels.length <= 2) {
    return labels.join(', ')
  }
  return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`
}

export function DataTableFilter({
  filter,
  open,
  onOpenChange,
}: {
  filter: DataTableOptionsFilterDef
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const selected = readFilterValue(filter)
  const selectedLabels = filter.options
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label)

  function toggle(value: string, checked: boolean) {
    writeFilterValue(
      filter,
      checked
        ? [...selected, value]
        : selected.filter((current) => current !== value),
    )
  }

  return (
    <FilterChip
      filter={filter}
      summary={
        selectedLabels.length > 0 ? summarizeSelection(selectedLabels) : null
      }
      onClear={() => writeFilterValue(filter, [])}
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="w-56"
    >
      <ul className="flex flex-col" role="group" aria-label={filter.label}>
        {filter.options.map((option) => {
          const id = `${filter.id}-${option.value}`
          const checked = selected.includes(option.value)
          return (
            <li key={option.value}>
              <label
                htmlFor={id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted"
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={(next) =>
                    toggle(option.value, next === true)
                  }
                />
                {option.dotClassName ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      option.dotClassName,
                    )}
                  />
                ) : null}
                <span className="truncate">{option.label}</span>
              </label>
            </li>
          )
        })}
      </ul>
      {selected.length > 0 ? (
        <div className="mt-1 border-t border-border pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => writeFilterValue(filter, [])}
          >
            Clear
          </Button>
        </div>
      ) : null}
    </FilterChip>
  )
}

const rangeDayFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
})
const rangeDayYearFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

// "Sep 21 – Oct 3, 2026", or "Sep 21, 2026" for a single day; open ends read
// "From …" / "Until …".
export function formatDateRangeSummary(range: DateRangeFilterValue) {
  const from = range.from === undefined ? null : new Date(range.from)
  const to = range.to === undefined ? null : new Date(range.to)
  if (from && to) {
    if (from.toDateString() === to.toDateString()) {
      return rangeDayYearFormatter.format(from)
    }
    const sameYear = from.getFullYear() === to.getFullYear()
    return `${(sameYear ? rangeDayFormatter : rangeDayYearFormatter).format(
      from,
    )} – ${rangeDayYearFormatter.format(to)}`
  }
  if (from) {
    return `From ${rangeDayYearFormatter.format(from)}`
  }
  if (to) {
    return `Until ${rangeDayYearFormatter.format(to)}`
  }
  return null
}

// The stored range is inclusive epoch ms, so a picked end day covers its
// whole day rather than stopping at midnight.
function endOfDay(date: Date) {
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)
  return end.getTime()
}

function startOfDay(date: Date) {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start.getTime()
}

export function DataTableDateRangeFilter({
  filter,
  open,
  onOpenChange,
}: {
  filter: DataTableDateRangeFilterDef
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const range = readDateRange(filter)
  const selected: DateRange | undefined =
    range.from === undefined && range.to === undefined
      ? undefined
      : {
          from: range.from === undefined ? undefined : new Date(range.from),
          to: range.to === undefined ? undefined : new Date(range.to),
        }

  return (
    <FilterChip
      filter={filter}
      summary={formatDateRangeSummary(range)}
      onClear={() => writeDateRange(filter, undefined)}
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="w-auto"
    >
      <Calendar
        mode="range"
        selected={selected}
        defaultMonth={selected?.from}
        onSelect={(next) =>
          writeDateRange(
            filter,
            next
              ? {
                  from: next.from ? startOfDay(next.from) : undefined,
                  to: next.to ? endOfDay(next.to) : undefined,
                }
              : undefined,
          )
        }
      />
      {selected ? (
        <div className="mt-1 border-t border-border pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => writeDateRange(filter, undefined)}
          >
            Clear
          </Button>
        </div>
      ) : null}
    </FilterChip>
  )
}
