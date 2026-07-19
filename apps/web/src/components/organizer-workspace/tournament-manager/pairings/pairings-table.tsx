import { useQuery } from 'convex/react'
import { Swords } from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { ManageMatchMenu } from './manage-match-menu'
import { MatchResultCell } from './match-result-cell'
import { pairedPlayerName } from './pairing-row'
import type { ColumnDef } from '@tanstack/react-table'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import type { PairingRow } from './pairing-row'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { Badge } from '@/components/ui/badge'
import { DataTable, DataTableColumnHeader } from '@/components/ui/data-table'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'

const pairingColumns: Array<ColumnDef<PairingRow>> = [
  {
    id: 'table',
    accessorFn: (row) => row.match.tableNumber ?? Number.POSITIVE_INFINITY,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Table" />
    ),
    meta: { className: 'w-20' },
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">
        {row.original.match.tableNumber ?? (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </span>
    ),
  },
  {
    id: 'players',
    accessorFn: (row) =>
      row.players.map((player) => pairedPlayerName(player)).join(' '),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Players" />
    ),
    // Greedy column absorbs name-length variance so the columns after it stay
    // put as pairings change across pages.
    meta: { className: 'w-full' },
    enableSorting: false,
    cell: ({ row }) => <PairingPlayersCell row={row.original} />,
  },
  {
    id: 'result',
    header: 'Result',
    enableSorting: false,
    cell: ({ row }) => <MatchResultCell row={row.original} />,
  },
  {
    id: 'actions',
    header: 'Manage',
    enableSorting: false,
    meta: { className: 'text-right' },
    cell: ({ row }) => <ManageMatchMenu row={row.original} />,
  },
]

export function PairingsTable({ roundId }: { roundId: Id<'tournamentRounds'> }) {
  const pairings = useQuery(api.tournaments.rounds.listRoundPairings, {
    roundId,
  })

  if (pairings === undefined) {
    return <TableLoadingSkeleton />
  }

  if (pairings.length === 0) {
    return (
      <Empty className="min-h-64">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Swords />
          </EmptyMedia>
          <EmptyTitle>No matches in this round</EmptyTitle>
          <EmptyDescription>
            Pairings for this round will appear here once they are generated.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <DataTable
      columns={pairingColumns}
      data={pairings}
      className="min-w-[640px]"
      noResultsLabel="No matches match your search."
      toolbar={(table) => (
        <Input
          placeholder="Search players..."
          value={String(table.getColumn('players')?.getFilterValue() ?? '')}
          onChange={(event) =>
            table.getColumn('players')?.setFilterValue(event.target.value)
          }
          className="max-w-xs"
        />
      )}
    />
  )
}

function PairingPlayersCell({ row }: { row: PairingRow }) {
  const playerOne = row.players.at(0)
  const playerTwo = row.players.at(1)
  const isBye = row.players.some((player) => player.isBye)

  return (
    <>
      <p className="font-medium text-foreground">
        {pairedPlayerName(playerOne)}
        {isBye ? null : (
          <span className="font-normal text-muted-foreground"> vs.</span>
        )}
      </p>
      {isBye ? (
        <Badge variant="secondary" className="mt-1">
          Bye
        </Badge>
      ) : (
        <p className="font-medium text-foreground">
          {pairedPlayerName(playerTwo)}
        </p>
      )}
    </>
  )
}
