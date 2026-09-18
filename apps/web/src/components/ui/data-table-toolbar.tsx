'use client'

import * as React from 'react'
import { Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import type { Column } from '@tanstack/react-table'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
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
// actions pinned to the right. Filters hold a set of option values; each chip
// reads "+ Label" until it has a value and then names what it holds.

export type DataTableFilterOption = {
  value: string
  label: string
  // A semantic dot beside the label (a `bg-*` class), for status-like options.
  dotClassName?: string
}

export type DataTableFilterDef = {
  id: string
  label: string
  icon?: LucideIcon
  options: Array<DataTableFilterOption>
  // Secondary filters live under "More filters" until picked or non-empty.
  secondary?: boolean
  // Bind to a TanStack column (its filter value is the selected option
  // values, see `oneOfFilter` in data-table.tsx), or control it directly.
  column?: Column<any, unknown>
  value?: Array<string>
  onChange?: (value: Array<string>) => void
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
      !filter.secondary ||
      revealed.has(filter.id) ||
      readFilterValue(filter).length > 0,
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

      {visible.map((filter) => (
        <DataTableFilter
          key={filter.id}
          filter={filter}
          open={openId === filter.id}
          onOpenChange={(open) => setOpenId(open ? filter.id : null)}
        />
      ))}

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

function readFilterValue(filter: DataTableFilterDef): Array<string> {
  if (filter.column) {
    const value = filter.column.getFilterValue()
    return Array.isArray(value) ? (value as Array<string>) : []
  }
  return filter.value ?? []
}

function writeFilterValue(filter: DataTableFilterDef, value: Array<string>) {
  if (filter.column) {
    filter.column.setFilterValue(value.length > 0 ? value : undefined)
  }
  filter.onChange?.(value)
}

export function DataTableFilter({
  filter,
  open,
  onOpenChange,
}: {
  filter: DataTableFilterDef
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const selected = readFilterValue(filter)
  const selectedLabels = filter.options
    .filter((option) => selected.includes(option.value))
    .map((option) => option.label)
  const Icon = filter.icon ?? Plus

  function toggle(value: string, checked: boolean) {
    writeFilterValue(
      filter,
      checked
        ? [...selected, value]
        : selected.filter((current) => current !== value),
    )
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div className="flex items-center">
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={
              selectedLabels.length > 0
                ? `${filter.label}: ${selectedLabels.join(', ')}`
                : `Filter by ${filter.label.toLowerCase()}`
            }
            className={cn(
              selectedLabels.length > 0 && 'rounded-r-none border-r-0',
            )}
          >
            <Icon data-icon="inline-start" />
            {filter.label}
            {selectedLabels.length > 0 ? (
              <span className="max-w-40 truncate font-normal text-muted-foreground">
                {selectedLabels.join(', ')}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        {selectedLabels.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Clear ${filter.label.toLowerCase()} filter`}
            className="rounded-l-none"
            onClick={() => writeFilterValue(filter, [])}
          >
            <X />
          </Button>
        ) : null}
      </div>
      <PopoverContent align="start" className="w-56 gap-0 p-1">
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
      </PopoverContent>
    </Popover>
  )
}
