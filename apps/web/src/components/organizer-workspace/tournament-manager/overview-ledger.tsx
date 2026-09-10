import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { ClipboardCheck } from 'lucide-react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { displayPlayerName } from '@paper-pairings/core'
import { EnterResultDialog } from './pairings/enter-result-dialog'
import {
  ScoreSlipPlayers,
  ScoreSlipResult,
  ScoreSlipTable,
} from './pairings/score-slip'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { BestOf } from '@paper-pairings/shared/match-structure'
import type { PairingRow } from './pairings/pairing-row'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

// The overview's main body during a round: the tables still playing, as a
// ledger of score slips, with the bye accounted for so the table count and
// the player count never leave the organizer doing arithmetic.
export function OutstandingTablesCard({
  roundId,
  roundLabel,
  bestOf,
  publicCode,
}: {
  roundId: Id<'tournamentRounds'>
  roundLabel: string
  bestOf: BestOf
  publicCode: string
}) {
  const pairings = useQuery(api.tournaments.rounds.listRoundPairings, {
    roundId,
  })

  if (pairings === undefined) {
    return <Skeleton className="h-64 rounded-xl" />
  }

  const byes = pairings.filter((row) =>
    row.players.some((player) => player.isBye),
  )
  const tables = pairings.filter(
    (row) => !row.players.some((player) => player.isBye),
  )
  const outstanding = tables.filter(
    (row) => row.match.matchStatus !== 'completed',
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {outstanding.length === 0
            ? 'All tables reported'
            : `Waiting on ${outstanding.length} ${outstanding.length === 1 ? 'table' : 'tables'}`}
        </CardTitle>
        <CardDescription>
          {roundLabel}, {tables.length}{' '}
          {tables.length === 1 ? 'table' : 'tables'}
          {byes.length > 0
            ? `, ${byes.length} ${byes.length === 1 ? 'bye' : 'byes'}`
            : ''}
          .{' '}
          <Link
            to="/admin/tournaments/$tournamentId/pairings"
            params={{ tournamentId: publicCode }}
            className="underline underline-offset-4 hover:text-foreground"
          >
            All pairings
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {outstanding.length === 0 ? (
          <Empty className="py-8">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardCheck />
              </EmptyMedia>
              <EmptyTitle>Every result is in</EmptyTitle>
              <EmptyDescription>
                Complete the round to post standings and pair the next one.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y divide-border">
            {outstanding.map((row) => (
              <LedgerRow key={row.match._id} row={row} bestOf={bestOf} />
            ))}
          </ul>
        )}
        {byes.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            {byes.length === 1 ? 'Bye this round: ' : 'Byes this round: '}
            <span className="font-medium text-foreground">
              {byes
                .map((row) =>
                  displayPlayerName(
                    row.players.find((player) => !player.isBye)?.playerName,
                  ),
                )
                .join(', ')}
            </span>
            . Awarded as a win, no table.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function LedgerRow({ row, bestOf }: { row: PairingRow; bestOf: BestOf }) {
  const [entering, setEntering] = useState(false)
  return (
    <li className="flex items-center gap-4 py-2.5">
      <span className="w-8 shrink-0 text-right">
        <ScoreSlipTable row={row} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        <ScoreSlipPlayers row={row} layout="inline" />
      </span>
      <ScoreSlipResult row={row} className="hidden sm:inline-flex" />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setEntering(true)}
      >
        Enter result
      </Button>
      {entering ? (
        <EnterResultDialog
          row={row}
          bestOf={bestOf}
          open={entering}
          onOpenChange={setEntering}
        />
      ) : null}
    </li>
  )
}

// Player-reported results nobody has confirmed. They already count toward
// completing the round (CONTEXT.md "Reported Result"), so this is a review
// list rather than a blocker; an organizer entry replaces the report.
export function UnconfirmedResultsCard({
  roundId,
  bestOf,
}: {
  roundId: Id<'tournamentRounds'>
  bestOf: BestOf
}) {
  const pairings = useQuery(api.tournaments.rounds.listRoundPairings, {
    roundId,
  })
  const unconfirmed = (pairings ?? []).filter(
    (row) =>
      row.match.matchStatus === 'completed' &&
      row.match.reportedByRegistrationId !== undefined,
  )
  if (unconfirmed.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs a look</CardTitle>
        <CardDescription>
          Reported by one player and not yet confirmed. Each counts toward
          completing the round unless you change it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {unconfirmed.map((row) => (
            <UnconfirmedRow key={row.match._id} row={row} bestOf={bestOf} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function UnconfirmedRow({ row, bestOf }: { row: PairingRow; bestOf: BestOf }) {
  const [editing, setEditing] = useState(false)
  const reporter = row.players.find(
    (player) => player.playerId === row.match.reportedByRegistrationId,
  )
  return (
    <li className="flex flex-col gap-1.5 py-2.5 text-sm">
      <div className="flex items-center gap-3">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-1.5 shrink-0 rounded-full bg-round-pairings"
          />
          <span className="text-muted-foreground">Table</span>
          <ScoreSlipTable row={row} />
        </span>
        <span className="ml-auto">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
          >
            Edit result
          </Button>
        </span>
      </div>
      <ScoreSlipResult row={row} />
      <p className="text-xs text-muted-foreground">
        Reported by {displayPlayerName(reporter?.playerName)}.
      </p>
      {editing ? (
        <EnterResultDialog
          row={row}
          bestOf={bestOf}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}
    </li>
  )
}
