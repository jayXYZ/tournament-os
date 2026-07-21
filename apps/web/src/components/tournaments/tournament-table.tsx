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
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'

import { TableEmptyState } from '@/components/shared/table-empty-state'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { TableSearchInput } from '@/components/shared/table-search-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DataTable,
  DataTableColumnHeader,
} from '@/components/ui/data-table'

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
    const copy = loadingCopy[variant]
    return (
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <TableLoadingSkeleton rows={variant === 'registered' ? 2 : 3} />
        </CardContent>
      </Card>
    )
  }

  if (items.length === 0) {
    return <TournamentTableEmpty variant={variant} />
  }

  const copy = populatedCopy[variant]
  const isManage = variant === 'manage'
  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  )
}

const loadingCopy: Record<
  TournamentTableVariant,
  { description: string; title: string }
> = {
  public: {
    title: 'Loading tournaments',
    description: 'Fetching public events available to players.',
  },
  registered: {
    title: 'My tournaments',
    description: 'Checking your ongoing and upcoming registrations.',
  },
  manage: {
    title: 'Loading tournaments',
    description: 'Fetching events for the selected organization.',
  },
}

const populatedCopy: Record<
  TournamentTableVariant,
  { description: string; title: string }
> = {
  public: {
    title: 'Public tournament schedule',
    description: 'Upcoming events published by tournament organizers.',
  },
  registered: {
    title: 'My tournaments',
    description: 'Ongoing and upcoming events you are registered for.',
  },
  manage: {
    title: 'Tournament schedule',
    description: 'Upcoming organization tournaments.',
  },
}

function TournamentTableEmpty({
  variant,
}: {
  variant: TournamentTableVariant
}) {
  if (variant === 'registered') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My tournaments</CardTitle>
          <CardDescription>
            You are not registered for any upcoming events yet. Pick one from
            the schedule below to get started.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const empty = (
    <TableEmptyState
      icon={variant === 'public' ? UserRound : CalendarDays}
      title="No upcoming tournaments"
      description={
        variant === 'public'
          ? 'Public tournaments will appear here once an organizer publishes future events.'
          : 'Future tournaments for this organization will appear here.'
      }
      className={variant === 'public' ? 'min-h-80 border bg-card' : undefined}
    />
  )

  if (variant === 'public') {
    return empty
  }

  return (
    <Card>
      <CardContent>{empty}</CardContent>
    </Card>
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
        const { tournament } = row.original
        return (
          <div className="flex min-w-0 items-center gap-2">
            <p className="font-medium text-foreground">{tournament.name}</p>
            {tournament.isTestEvent ? (
              <Badge variant="outline">Test</Badge>
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
      cell: ({ row }) => {
        const { tournament } = row.original
        const publicCode = String(tournament.publicCode)
        return (
          <TournamentTableAction
            manageHref={`/admin/tournaments/${publicCode}`}
            publicCode={publicCode}
            tournament={tournament}
            variant={variant}
          />
        )
      },
    },
  )

  return columns
}

function TournamentTableAction({
  manageHref,
  publicCode,
  tournament,
  variant,
}: {
  manageHref: string
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
        <Link to={manageHref}>
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
            Open player controller
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
