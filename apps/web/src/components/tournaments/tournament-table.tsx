import * as React from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Swords,
  Ticket,
  UserRound,
} from 'lucide-react'
import { tournamentFormats } from '@paper-pairings/shared/tournament-creation-utils'
import {
  TournamentLifecycleBadge,
  formatTournamentDateShort,
  tournamentLifecycleFilterOptions,
} from './tournament-display'
import {
  columnFiltersFromSearch,
  searchFromColumnFilters,
} from './tournament-table-search'
import type {
  ColumnDef,
  ColumnFiltersState,
  OnChangeFn,
  Row,
  Table as TanstackTable,
} from '@tanstack/react-table'
import type { TournamentTableSearchParams } from './tournament-table-search'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import type {
  DataTableFilterDef,
  DataTableFilterOption,
} from '@/components/ui/data-table-toolbar'

import { formatConventionDateRange } from '@/components/conventions/convention-display'
import { TableEmptyState } from '@/components/shared/table-empty-state'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DataTable,
  DataTableColumnHeader,
  dateRangeFilter,
  oneOfFilter,
} from '@/components/ui/data-table'
import {
  DataTableToolbar,
  columnSearch,
} from '@/components/ui/data-table-toolbar'
import { cn } from '@/lib/utils'

export type TournamentTableVariant = 'public' | 'registered' | 'manage'

export type TournamentTableItem = {
  key: string
  organizationName?: string | null
  registeredCount?: number
  registration?: Doc<'tournamentRegistrations'>
  tournament: Doc<'tournaments'>
}

// A convention listed in the same table as tournaments. Its child events
// (tournaments whose conventionId matches) nest beneath it as a collapsible
// group; tournaments with no listed parent stay at the top level.
export type TournamentTableConvention = {
  key: string
  organizationName?: string | null
  registeredCount?: number
  convention: Doc<'conventions'>
}

type TournamentRow = { kind: 'tournament' } & TournamentTableItem
type ConventionRow = {
  kind: 'convention'
  events: Array<TournamentRow>
} & TournamentTableConvention
type TournamentTableRow = TournamentRow | ConventionRow

export function TournamentTable({
  items,
  conventions,
  variant,
  search,
  onSearchChange,
}: {
  items: Array<TournamentTableItem> | undefined
  // When present, the table groups events under their conventions. Pass it
  // only once loaded so the grouping never flashes in after the flat list.
  conventions?: Array<TournamentTableConvention>
  variant: TournamentTableVariant
  // Toolbar state kept by the caller, in practice the route's search params
  // (see tournament-table-search.ts), so filters survive reload and the
  // back button. Pass both or neither; without them the table keeps the
  // state itself.
  search?: TournamentTableSearchParams
  onSearchChange?: (next: TournamentTableSearchParams) => void
}) {
  const navigate = useNavigate()
  const grouped = conventions !== undefined
  const columns = React.useMemo(
    () => buildTournamentColumns(variant, grouped),
    [variant, grouped],
  )
  const rows = React.useMemo(
    () => (items ? buildRows(items, conventions ?? []) : undefined),
    [items, conventions],
  )
  // The manage list holds every lifecycle the organization has ever run, so
  // it opens narrowed to the events still in play; widening the Status chip
  // reaches completed and cancelled ones. The other variants already
  // arrive scoped by the server and start unfiltered. The same codec that
  // reads the URL supplies the uncontrolled table's starting point.
  const controlled = search !== undefined && onSearchChange !== undefined
  const columnFilters = React.useMemo<ColumnFiltersState>(
    () => columnFiltersFromSearch(search ?? {}, variant),
    [search, variant],
  )
  const handleColumnFiltersChange = React.useCallback<
    OnChangeFn<ColumnFiltersState>
  >(
    (updater) => {
      const next =
        typeof updater === 'function' ? updater(columnFilters) : updater
      onSearchChange?.(searchFromColumnFilters(next, variant))
    },
    [columnFilters, onSearchChange, variant],
  )

  if (rows === undefined) {
    return (
      <TournamentSection variant={variant} description={loadingCopy[variant]}>
        <TableLoadingSkeleton rows={variant === 'registered' ? 2 : 3} />
      </TournamentSection>
    )
  }

  if (rows.length === 0) {
    return <TournamentTableEmpty variant={variant} />
  }

  const isManage = variant === 'manage'
  return (
    <TournamentSection variant={variant} description={populatedCopy[variant]}>
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(row) => row.key}
        getSubRows={(row) =>
          row.kind === 'convention' ? row.events : undefined
        }
        className={isManage ? 'min-w-[760px]' : 'min-w-[900px]'}
        noResultsLabel={
          grouped
            ? 'No events match these filters.'
            : 'No tournaments match these filters.'
        }
        initialColumnFilters={columnFilters}
        columnFilters={controlled ? columnFilters : undefined}
        onColumnFiltersChange={
          controlled ? handleColumnFiltersChange : undefined
        }
        onRowClick={
          isManage
            ? (row) =>
                navigate(
                  row.kind === 'convention'
                    ? {
                        to: '/admin/conventions/$conventionId',
                        params: {
                          conventionId: String(row.convention.publicCode),
                        },
                      }
                    : {
                        to: '/admin/tournaments/$tournamentId',
                        params: {
                          tournamentId: String(row.tournament.publicCode),
                        },
                      },
                )
            : undefined
        }
        toolbar={(table) => {
          // Status only means something where more than one lifecycle can
          // appear: the public schedule is registration-only by the time it
          // reaches the client. Start date waits under "More filters" since
          // most visits never narrow by it.
          const filters: Array<DataTableFilterDef> = []
          if (variant !== 'public') {
            filters.push({
              id: 'status',
              label: 'Status',
              options: tournamentLifecycleFilterOptions,
              column: table.getColumn('status'),
            })
          }
          filters.push(
            {
              id: 'format',
              label: 'Format',
              options: formatFilterOptions,
              column: table.getColumn('format'),
            },
            {
              id: 'startDate',
              kind: 'dateRange',
              label: 'Start date',
              secondary: true,
              column: table.getColumn('startDate'),
            },
          )
          return (
            <DataTableToolbar
              search={columnSearch(
                table.getColumn('tournament'),
                grouped ? 'Search events' : 'Search tournaments',
              )}
              filters={filters}
            />
          )
        }}
      />
    </TournamentSection>
  )
}

// The Format chip offers every tournament format. A convention row's own
// format is "convention" and never matches, but the table filters from leaf
// rows so a convention stays listed while any of its events match.
const formatFilterOptions: Array<DataTableFilterOption> = tournamentFormats.map(
  (format) => ({
    value: format,
    label: format.charAt(0).toUpperCase() + format.slice(1),
  }),
)

// Conventions and standalone tournaments share the top level, ordered by
// start date; each convention's children keep the order they arrived in.
function buildRows(
  items: Array<TournamentTableItem>,
  conventions: Array<TournamentTableConvention>,
): Array<TournamentTableRow> {
  const parents = new Map<string, ConventionRow>(
    conventions.map((entry) => [
      entry.convention._id,
      { kind: 'convention', events: [], ...entry },
    ]),
  )
  const standalone: Array<TournamentRow> = []
  for (const item of items) {
    const row: TournamentRow = { kind: 'tournament', ...item }
    const parent = item.tournament.conventionId
      ? parents.get(item.tournament.conventionId)
      : undefined
    if (parent) {
      parent.events.push(row)
    } else {
      standalone.push(row)
    }
  }
  return [...parents.values(), ...standalone].sort(
    (left, right) => rowStartDate(left) - rowStartDate(right),
  )
}

function rowStartDate(row: TournamentTableRow) {
  return row.kind === 'convention'
    ? row.convention.startDate
    : row.tournament.startDate
}

// The public and manage tables sit directly under a page title that already
// names them, so only the registered list (which shares a page with the
// public schedule) carries its own heading. The others show their
// description as a single muted line.
const sectionTitle: Partial<Record<TournamentTableVariant, string>> = {
  registered: 'My tournaments',
}

const loadingCopy: Record<TournamentTableVariant, string> = {
  public: 'Fetching public events available to players.',
  registered: 'Checking your ongoing and upcoming registrations.',
  manage: 'Fetching events for the selected organization.',
}

const populatedCopy: Record<TournamentTableVariant, string> = {
  public: 'Upcoming events published by tournament organizers.',
  registered: 'Ongoing and upcoming events you are registered for.',
  manage: "Your organization's tournaments and conventions.",
}

function TournamentSection({
  variant,
  description,
  children,
}: {
  variant: TournamentTableVariant
  description: string
  children?: React.ReactNode
}) {
  const title = sectionTitle[variant]
  return (
    <section className="flex flex-col gap-4">
      <div>
        {title ? <h2 className="text-sm font-medium">{title}</h2> : null}
        <p className="text-xs/relaxed text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

function TournamentTableEmpty({
  variant,
}: {
  variant: TournamentTableVariant
}) {
  if (variant === 'registered') {
    return (
      <TournamentSection
        variant={variant}
        description="You are not registered for any upcoming events yet. Pick one from the schedule below to get started."
      />
    )
  }

  return (
    <TableEmptyState
      icon={variant === 'public' ? UserRound : CalendarDays}
      title="No upcoming tournaments"
      description={
        variant === 'public'
          ? 'Public tournaments will appear here once an organizer publishes future events.'
          : 'Future tournaments for this organization will appear here.'
      }
      className={cn(
        'rounded-lg border border-border',
        variant === 'public' && 'min-h-80',
      )}
    />
  )
}

function buildTournamentColumns(
  variant: TournamentTableVariant,
  grouped: boolean,
): Array<ColumnDef<TournamentTableRow>> {
  const showOrganizer = variant !== 'manage'

  const columns: Array<ColumnDef<TournamentTableRow>> = [
    {
      id: 'tournament',
      accessorFn: (row) =>
        row.kind === 'convention' ? row.convention.name : row.tournament.name,
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={grouped ? 'Event' : 'Tournament'}
        />
      ),
      // Greedy column absorbs name-length variance so later columns stay
      // put. `relative` anchors the tree connector lines of nested rows.
      meta: { className: 'relative w-full' },
      cell: ({ row, table }) =>
        row.original.kind === 'convention' ? (
          <ConventionNameCell row={row} />
        ) : (
          <TournamentNameCell
            row={row}
            table={table}
            item={row.original}
            grouped={grouped}
          />
        ),
    },
  ]

  if (showOrganizer) {
    columns.push({
      id: 'organizer',
      accessorFn: (row) => row.organizationName ?? '',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Organizer" />
      ),
      cell: ({ row }) => row.original.organizationName ?? '—',
    })
  }

  columns.push(
    {
      id: 'format',
      accessorFn: (row) =>
        row.kind === 'convention' ? 'convention' : row.tournament.format,
      filterFn: oneOfFilter,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Format" />
      ),
      meta: { className: 'capitalize' },
      cell: ({ row }) =>
        row.original.kind === 'convention' ? (
          <span className="text-muted-foreground">Convention</span>
        ) : (
          row.original.tournament.format
        ),
    },
    {
      id: 'startDate',
      accessorFn: rowStartDate,
      filterFn: dateRangeFilter,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Start date" />
      ),
      cell: ({ row }) =>
        row.original.kind === 'convention'
          ? formatConventionDateRange(
              row.original.convention.startDate,
              row.original.convention.endDate,
            )
          : formatTournamentDateShort(row.original.tournament.startDate),
    },
    {
      id: 'players',
      accessorFn: (row) => row.registeredCount ?? 0,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Players" />
      ),
      cell: ({ row }) => {
        const capacity =
          row.original.kind === 'convention'
            ? row.original.convention.playerCapacity
            : row.original.tournament.playerCapacity
        return (
          <span className="inline-flex items-center gap-1 tabular-nums">
            {/* A convention's count is badges sold, not seated players. */}
            {row.original.kind === 'convention' ? (
              <Ticket
                className="size-3 text-muted-foreground"
                aria-label="Badges"
              />
            ) : null}
            {row.original.registeredCount ?? 0}
            <span className="text-muted-foreground">/ {capacity}</span>
          </span>
        )
      },
    },
    {
      id: 'status',
      accessorFn: (row) =>
        row.kind === 'convention'
          ? row.convention.lifecycle
          : row.tournament.lifecycle,
      filterFn: oneOfFilter,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => (
        <TournamentLifecycleBadge
          lifecycle={
            row.original.kind === 'convention'
              ? row.original.convention.lifecycle
              : row.original.tournament.lifecycle
          }
        />
      ),
    },
    {
      id: 'actions',
      // The manage row is itself the link, so its trailing cell is only a
      // chevron (still a real link, for keyboards and screen readers); the
      // other variants offer a verb because their rows do not navigate.
      header: () =>
        variant === 'manage' ? <span className="sr-only">Open</span> : 'Action',
      enableSorting: false,
      meta: { className: 'text-right' },
      cell: ({ row }) =>
        row.original.kind === 'convention' ? (
          <ConventionTableAction
            publicCode={String(row.original.convention.publicCode)}
            variant={variant}
          />
        ) : (
          <TournamentTableAction
            publicCode={String(row.original.tournament.publicCode)}
            tournament={row.original.tournament}
            variant={variant}
          />
        ),
    },
  )

  return columns
}

function ConventionNameCell({ row }: { row: Row<TournamentTableRow> }) {
  const { convention, events } = row.original as ConventionRow
  const expanded = row.getIsExpanded()
  const count = events.length
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="-ml-1.5 text-muted-foreground"
        aria-expanded={expanded}
        aria-label={
          expanded
            ? `Collapse ${convention.name} events`
            : `Expand ${convention.name} events`
        }
        disabled={count === 0}
        onClick={(event) => {
          event.stopPropagation()
          row.toggleExpanded()
        }}
      >
        {expanded ? <ChevronDown /> : <ChevronRight />}
      </Button>
      <p className="font-medium text-foreground">{convention.name}</p>
      <span className="text-muted-foreground">
        {count === 1 ? '1 event' : `${count} events`}
      </span>
      {convention.isTestEvent ? <Badge variant="outline">Test</Badge> : null}
    </div>
  )
}

function TournamentNameCell({
  row,
  table,
  item,
  grouped,
}: {
  row: Row<TournamentTableRow>
  table: TanstackTable<TournamentTableRow>
  item: TournamentRow
  grouped: boolean
}) {
  const { registration, tournament } = item
  const nested = row.depth > 0
  return (
    <>
      {nested ? <TreeConnector last={isLastVisibleChild(row, table)} /> : null}
      <div
        className={cn(
          'flex min-w-0 items-center gap-2',
          // Nested events sit past the connector; top-level events in a
          // grouped table skip the chevron slot so names line up.
          nested ? 'pl-10' : grouped && 'pl-6',
        )}
      >
        <p className="font-medium text-foreground">{tournament.name}</p>
        {tournament.isTestEvent ? <Badge variant="outline">Test</Badge> : null}
        {/* Only the registered variant carries a registration; an entry
            still under organizer review is flagged so the listing never
            reads as a held seat. */}
        {registration?.entryStatus === 'pending' ? (
          <Badge variant="outline">Pending approval</Badge>
        ) : registration?.entryStatus === 'waitlisted' ? (
          <Badge variant="outline">Waitlisted</Badge>
        ) : null}
      </div>
    </>
  )
}

// Whether no sibling follows this row on the rendered page, so the vertical
// tree line can stop at the row's midpoint instead of running off the
// bottom. Uses the paginated, sorted, filtered rows so it tracks what is
// actually on screen.
function isLastVisibleChild(
  row: Row<TournamentTableRow>,
  table: TanstackTable<TournamentTableRow>,
) {
  const rows = table.getRowModel().rows
  const index = rows.findIndex((candidate) => candidate.id === row.id)
  const next = rows.at(index + 1)
  return next === undefined || next.depth < row.depth
}

// The ├─ / └─ lines that tie a nested event to its convention. Positioned
// against the cell (which is `relative`) so the vertical rule spans the full
// row height, including the row border, and chains into the next sibling.
// The rule sits under the centre of the convention's chevron: the cell's
// 12px padding plus half the 24px button.
function TreeConnector({ last }: { last: boolean }) {
  return (
    <span aria-hidden="true" className="pointer-events-none">
      <span className="absolute top-[-1px] left-[23px] h-[calc(50%+1px)] w-px bg-border" />
      {last ? null : (
        <span className="absolute top-1/2 bottom-[-1px] left-[23px] w-px bg-border" />
      )}
      <span className="absolute top-1/2 left-[23px] h-px w-3 bg-border" />
    </span>
  )
}

// A quiet chevron at the end of a clickable row. Rendered as the row's link
// so tabbing reaches it; the click stops there so the row handler does not
// navigate a second time.
function RowChevronLink({
  label,
  children,
}: {
  label: string
  children: React.ReactElement
}) {
  return (
    <Button
      asChild
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      className="text-muted-foreground"
      onClick={(event: React.MouseEvent) => event.stopPropagation()}
    >
      {React.cloneElement(children, undefined, <ChevronRight />)}
    </Button>
  )
}

function ConventionTableAction({
  publicCode,
  variant,
}: {
  publicCode: string
  variant: TournamentTableVariant
}) {
  if (variant === 'manage') {
    return (
      <RowChevronLink label="Manage convention">
        <Link
          to="/admin/conventions/$conventionId"
          params={{ conventionId: publicCode }}
        />
      </RowChevronLink>
    )
  }

  return (
    <Button asChild type="button" variant="outline">
      <Link
        to="/conventions/$conventionId"
        params={{ conventionId: publicCode }}
      >
        View details
      </Link>
    </Button>
  )
}

function TournamentTableAction({
  publicCode,
  tournament,
  variant,
}: {
  publicCode: string
  tournament: Doc<'tournaments'>
  variant: TournamentTableVariant
}) {
  if (variant === 'manage') {
    return (
      <RowChevronLink label="Manage tournament">
        <Link
          to="/admin/tournaments/$tournamentId"
          params={{ tournamentId: publicCode }}
        />
      </RowChevronLink>
    )
  }

  if (variant === 'registered') {
    if (tournament.lifecycle === 'in_progress') {
      return (
        <Button asChild type="button">
          <Link
            to="/tournaments/$tournamentId/play"
            params={{ tournamentId: publicCode }}
          >
            <Swords data-icon="inline-start" />
            Open my player view
          </Link>
        </Button>
      )
    }

    return (
      <Button asChild type="button" variant="outline">
        <Link
          to="/tournaments/$tournamentId"
          params={{ tournamentId: publicCode }}
        >
          <Ticket data-icon="inline-start" />
          View event
        </Link>
      </Button>
    )
  }

  return (
    <Button asChild type="button" variant="outline">
      <Link
        to="/tournaments/$tournamentId"
        params={{ tournamentId: publicCode }}
      >
        View details
      </Link>
    </Button>
  )
}
