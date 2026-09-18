import * as React from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  CalendarDays,
  Swords,
  Ticket,
  UserRound,
} from 'lucide-react'
import {
  TournamentLifecycleBadge,
  formatTournamentDateShort,
} from './tournament-display'
import type { ColumnDef } from '@tanstack/react-table'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'

import { TableEmptyState } from '@/components/shared/table-empty-state'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { TableSearchInput } from '@/components/shared/table-search-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DataTable, DataTableColumnHeader } from '@/components/ui/data-table'
import { cn } from '@/lib/utils'

export type TournamentTableVariant = 'public' | 'registered' | 'manage'

export type TournamentTableItem = {
  key: string
  organizationName?: string | null
  registeredCount?: number
  registration?: Doc<'tournamentRegistrations'>
  tournament: Doc<'tournaments'>
}

export function TournamentTable({
  items,
  variant,
}: {
  items: Array<TournamentTableItem> | undefined
  variant: TournamentTableVariant
}) {
  const navigate = useNavigate()
  const columns = React.useMemo(
    () => buildTournamentColumns(variant),
    [variant],
  )

  if (items === undefined) {
    return (
      <TournamentSection variant={variant} description={loadingCopy[variant]}>
        <TableLoadingSkeleton rows={variant === 'registered' ? 2 : 3} />
      </TournamentSection>
    )
  }

  if (items.length === 0) {
    return <TournamentTableEmpty variant={variant} />
  }

  const isManage = variant === 'manage'
  return (
    <TournamentSection variant={variant} description={populatedCopy[variant]}>
      <DataTable
        columns={columns}
        data={items}
        className={isManage ? 'min-w-[760px]' : 'min-w-[900px]'}
        noResultsLabel="No tournaments match your search."
        onRowClick={
          isManage
            ? (item) =>
                navigate({
                  to: `/admin/tournaments/${String(
                    item.tournament.publicCode,
                  )}`,
                })
            : undefined
        }
        toolbar={(table) => (
          <TableSearchInput
            table={table}
            columnId="tournament"
            placeholder="Search tournaments..."
          />
        )}
      />
    </TournamentSection>
  )
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
  manage: 'Upcoming organization tournaments.',
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
): Array<ColumnDef<TournamentTableItem>> {
  const showOrganizer = variant !== 'manage'

  const columns: Array<ColumnDef<TournamentTableItem>> = [
    {
      id: 'tournament',
      accessorFn: (item) => item.tournament.name,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Tournament" />
      ),
      // Greedy column absorbs name-length variance so later columns stay put.
      meta: { className: 'w-full' },
      cell: ({ row }) => {
        const { registration, tournament } = row.original
        return (
          <div className="flex min-w-0 items-center gap-2">
            <p className="font-medium text-foreground">{tournament.name}</p>
            {tournament.isTestEvent ? (
              <Badge variant="outline">Test</Badge>
            ) : null}
            {/* Only the registered variant carries a registration; an entry
                still under organizer review is flagged so the listing never
                reads as a held seat. */}
            {registration?.entryStatus === 'pending' ? (
              <Badge variant="outline">Pending approval</Badge>
            ) : registration?.entryStatus === 'waitlisted' ? (
              <Badge variant="outline">Waitlisted</Badge>
            ) : null}
          </div>
        )
      },
    },
  ]

  if (showOrganizer) {
    columns.push({
      id: 'organizer',
      accessorFn: (item) => item.organizationName ?? '',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Organizer" />
      ),
      cell: ({ row }) => row.original.organizationName ?? '—',
    })
  }

  columns.push(
    {
      id: 'format',
      accessorFn: (item) => item.tournament.format,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Format" />
      ),
      meta: { className: 'capitalize' },
      cell: ({ row }) => row.original.tournament.format,
    },
    {
      id: 'startDate',
      accessorFn: (item) => item.tournament.startDate,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Start date" />
      ),
      cell: ({ row }) =>
        formatTournamentDateShort(row.original.tournament.startDate),
    },
    {
      id: 'players',
      accessorFn: (item) => item.registeredCount ?? 0,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Players" />
      ),
      cell: ({ row }) => (
        <span className="tabular-nums">
          {row.original.registeredCount ?? 0}
          <span className="text-muted-foreground">
            {' / '}
            {row.original.tournament.playerCapacity}
          </span>
        </span>
      ),
    },
    {
      id: 'status',
      accessorFn: (item) => item.tournament.lifecycle,
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      cell: ({ row }) => (
        <TournamentLifecycleBadge
          lifecycle={row.original.tournament.lifecycle}
        />
      ),
    },
    {
      id: 'actions',
      header: 'Action',
      enableSorting: false,
      meta: { className: 'text-right' },
      cell: ({ row }) => (
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
      <Button
        asChild
        type="button"
        variant="outline"
        onClick={(event) => event.stopPropagation()}
      >
        <Link
          to="/admin/tournaments/$tournamentId"
          params={{ tournamentId: publicCode }}
        >
          Manage
          <ArrowRight data-icon="inline-end" />
        </Link>
      </Button>
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
