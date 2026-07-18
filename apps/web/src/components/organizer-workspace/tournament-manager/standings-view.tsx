import { useQuery } from 'convex/react'
import { Trophy } from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { formatPercent, formatRecord } from '@tournament-os/core'
import type { ColumnDef } from '@tanstack/react-table'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import type { RoundSelection } from '@/components/tournaments'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { useTournamentRoundNavigation } from '@/components/tournaments'
import { Card, CardContent } from '@/components/ui/card'
import { DataTable, DataTableColumnHeader } from '@/components/ui/data-table'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'

type StandingRow = FunctionReturnType<
  typeof api.tournaments.rounds.listRoundStandings
>[number]

export function StandingsView({
  tournamentId,
  roundSelection,
  onRoundSelectionChange,
}: {
  tournamentId: string
  roundSelection: RoundSelection
  onRoundSelectionChange: (selection: RoundSelection) => void
}) {
  const board = useQuery(api.tournaments.rounds.getPairingsBoard, {
    tournamentId: tournamentId as Id<'tournaments'>,
  })

  const phases = board?.phases ?? []
  const navigation = useTournamentRoundNavigation(
    phases,
    'completed',
    roundSelection,
    onRoundSelectionChange,
  )

  return (
    <section className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4">
          {board === undefined ? (
            <TableLoadingSkeleton />
          ) : !navigation.selectedRound ? (
            <Empty className="min-h-64">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Trophy />
                </EmptyMedia>
                <EmptyTitle>No standings yet</EmptyTitle>
                <EmptyDescription>
                  Standings are generated when a round is completed. Finish a
                  round to see the leaderboard here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <StandingsTable roundId={navigation.selectedRound._id} />
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function standingPlayerName(row: StandingRow) {
  return row.playerName ?? 'Unknown player'
}

const standingColumns: Array<ColumnDef<StandingRow>> = [
  {
    id: 'rank',
    accessorFn: (row) => row.standing.rank,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Rank" />
    ),
    meta: { className: 'w-16' },
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">
        {row.original.standing.rank}
      </span>
    ),
  },
  {
    id: 'player',
    accessorFn: (row) => standingPlayerName(row),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Player" />
    ),
    // Greedy column absorbs name-length variance so the stat columns stay put.
    meta: { className: 'w-full' },
    cell: ({ row }) => (
      <p className="font-medium text-foreground">
        {standingPlayerName(row.original)}
      </p>
    ),
  },
  {
    id: 'points',
    accessorFn: (row) => row.standing.matchPoints,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Points" className="ml-auto" />
    ),
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">
        {row.original.standing.matchPoints}
      </span>
    ),
  },
  {
    id: 'record',
    enableSorting: false,
    header: 'Record',
    meta: { className: 'text-right' },
    cell: ({ row }) => {
      const { standing } = row.original
      return (
        <span className="tabular-nums">
          {formatRecord(
            standing.matchWins,
            standing.matchLosses,
            standing.matchDraws,
          )}
        </span>
      )
    },
  },
  {
    id: 'omw',
    accessorFn: (row) => row.standing.opponentMatchWinPct,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="OMW%" className="ml-auto" />
    ),
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">
        {formatPercent(row.original.standing.opponentMatchWinPct)}
      </span>
    ),
  },
  {
    id: 'gw',
    accessorFn: (row) => row.standing.gameWinPct,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="GW%" className="ml-auto" />
    ),
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">
        {formatPercent(row.original.standing.gameWinPct)}
      </span>
    ),
  },
  {
    id: 'ogw',
    accessorFn: (row) => row.standing.opponentGameWinPct,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="OGW%" className="ml-auto" />
    ),
    meta: { className: 'text-right' },
    cell: ({ row }) => (
      <span className="tabular-nums text-muted-foreground">
        {formatPercent(row.original.standing.opponentGameWinPct)}
      </span>
    ),
  },
]

function StandingsTable({ roundId }: { roundId: Id<'tournamentRounds'> }) {
  const standings = useQuery(api.tournaments.rounds.listRoundStandings, {
    roundId,
  })

  if (standings === undefined) {
    return <TableLoadingSkeleton />
  }

  if (standings.length === 0) {
    return (
      <Empty className="min-h-64">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Trophy />
          </EmptyMedia>
          <EmptyTitle>No standings for this round</EmptyTitle>
          <EmptyDescription>
            Standings for this round will appear here once they are generated.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <DataTable
      columns={standingColumns}
      data={standings}
      className="min-w-[640px]"
      noResultsLabel="No players match your search."
      toolbar={(table) => (
        <Input
          placeholder="Search players..."
          value={String(table.getColumn('player')?.getFilterValue() ?? '')}
          onChange={(event) =>
            table.getColumn('player')?.setFilterValue(event.target.value)
          }
          className="max-w-xs"
        />
      )}
    />
  )
}
