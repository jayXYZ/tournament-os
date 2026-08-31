import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import { Swords } from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { displayPlayerName } from '@tournament-os/core'
import { ManageMatchMenu } from './manage-match-menu'
import { MatchResultCell } from './match-result-cell'
import type { ColumnDef } from '@tanstack/react-table'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import type { BestOf } from '@tournament-os/shared/match-structure'
import type { PairingRow } from './pairing-row'
import { TableEmptyState } from '@/components/shared/table-empty-state'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { TableSearchInput } from '@/components/shared/table-search-input'
import { Badge } from '@/components/ui/badge'
import { DataTable, DataTableColumnHeader } from '@/components/ui/data-table'

// Built per render because the manage cell needs the round's phase match
// structure to bound result entry, and whether the round's pairings are
// still organizer-editable.
function buildPairingColumns(
  bestOf: BestOf,
  canEditPairings: boolean,
): Array<ColumnDef<PairingRow>> {
  return [
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
        row.players
          .map((player) => displayPlayerName(player.playerName))
          .join(' '),
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
      cell: ({ row }) => (
        <ManageMatchMenu
          row={row.original}
          bestOf={bestOf}
          canEditPairings={canEditPairings}
        />
      ),
    },
  ]
}

export function PairingsTable({
  roundId,
  bestOf,
  canEditPairings,
}: {
  roundId: Id<'tournamentRounds'>
  bestOf: BestOf
  canEditPairings: boolean
}) {
  const pairings = useQuery(api.tournaments.rounds.listRoundPairings, {
    roundId,
  })
  const columns = useMemo(
    () => buildPairingColumns(bestOf, canEditPairings),
    [bestOf, canEditPairings],
  )

  if (pairings === undefined) {
    return <TableLoadingSkeleton />
  }

  if (pairings.length === 0) {
    return (
      <TableEmptyState
        icon={Swords}
        title="No matches in this round"
        description="Pairings for this round will appear here once they are generated."
      />
    )
  }

  return (
    <DataTable
      columns={columns}
      data={pairings}
      className="min-w-[640px]"
      noResultsLabel="No matches match your search."
      toolbar={(table) => (
        <TableSearchInput
          table={table}
          columnId="players"
          placeholder="Search players..."
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
        {displayPlayerName(playerOne?.playerName)}
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
          {displayPlayerName(playerTwo?.playerName)}
        </p>
      )}
    </>
  )
}
