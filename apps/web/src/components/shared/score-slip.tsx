import {
  displayPlayerName,
  formatGameScoreline,
  matchResultKindLabel,
} from '@paper-pairings/core'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '@paper-pairings/backend/convex/_generated/api'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// The score slip is the one piece of paper every organizer already knows:
// a table number, two names, and a result box that is empty until someone
// writes in it. These pieces are that slip's vocabulary, shared by the
// organizer's Pairings table and overview ledger and the public event page's
// matches, so a match reads the same everywhere.
//
// The slip's shape is the public match projection (getPublicMatches): only
// what anyone may see of a match. Organizer rows convert into it
// (pairing-row.ts toScoreSlip), so nothing organizer-only can reach the
// slip's rendering by accident.
export type ScoreSlip = NonNullable<
  FunctionReturnType<typeof api.tournaments.publicResults.getPublicMatches>
>['matches'][number]

export function ScoreSlipTable({ row }: { row: ScoreSlip }) {
  return (
    <span className="font-mono text-sm font-medium tabular-nums">
      {row.tableNumber ?? <span className="text-muted-foreground">Bye</span>}
    </span>
  )
}

export function ScoreSlipPlayers({
  row,
  layout = 'stacked',
}: {
  row: ScoreSlip
  layout?: 'stacked' | 'inline'
}) {
  const playerOne = row.players.at(0)
  const playerTwo = row.players.at(1)
  const isBye = row.players.some((player) => player.isBye)

  if (layout === 'inline') {
    return (
      <span className="font-medium text-foreground">
        {displayPlayerName(playerOne?.name)}
        {isBye ? (
          <span className="font-normal text-muted-foreground">
            {' '}
            has the bye
          </span>
        ) : (
          <>
            <span className="font-normal text-muted-foreground"> vs </span>
            {displayPlayerName(playerTwo?.name)}
          </>
        )}
      </span>
    )
  }

  return (
    <>
      <p className="font-medium text-foreground">
        {displayPlayerName(playerOne?.name)}
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
          {displayPlayerName(playerTwo?.name)}
        </p>
      )}
    </>
  )
}

// The result box. Empty and dashed until a result exists; then the scoreline
// with its provenance, because the scoreline alone cannot say whether a
// result was played, awarded, or reported by a player and not yet confirmed.
// `pendingLabel` names the empty box: "Awaiting" while the round is live,
// something else where no result will come (a cancelled event).
export function ScoreSlipResult({
  row,
  className,
  pendingLabel = 'Awaiting',
}: {
  row: ScoreSlip
  className?: string
  pendingLabel?: string
}) {
  const playerOne = row.players.at(0)
  const playerTwo = row.players.at(1)
  if (row.matchStatus !== 'completed') {
    return (
      <span
        aria-label={
          pendingLabel === 'Awaiting' ? 'Awaiting result' : pendingLabel
        }
        className={cn(
          'inline-flex h-6 min-w-14 items-center justify-center rounded-sm border border-dashed border-muted-foreground/50 px-1.5 text-xs text-muted-foreground',
          className,
        )}
      >
        {pendingLabel}
      </span>
    )
  }

  const playerOneWins = playerOne?.gameWins ?? 0
  const playerTwoWins = playerOne?.isBye
    ? (playerOne.gameLosses ?? 0)
    : (playerTwo?.gameWins ?? 0)
  const gameDraws = playerOne?.gameDraws ?? 0
  const kindLabel = matchResultKindLabel(row.resultKind)

  let summary: string
  if (playerOneWins === playerTwoWins) {
    summary = `Draw ${formatGameScoreline(playerOneWins, playerTwoWins, gameDraws)}`
  } else {
    const playerOneWon = playerOneWins > playerTwoWins
    const winnerName = displayPlayerName(
      (playerOneWon ? playerOne : playerTwo)?.name,
    )
    const winnerWins = playerOneWon ? playerOneWins : playerTwoWins
    const loserWins = playerOneWon ? playerTwoWins : playerOneWins
    summary = `${winnerName} wins ${formatGameScoreline(winnerWins, loserWins, gameDraws)}`
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="font-medium tabular-nums">{summary}</span>
      {kindLabel !== null ? (
        <Badge variant="secondary">{kindLabel}</Badge>
      ) : null}
      {row.playerReported ? (
        <Badge variant="outline">Player-reported</Badge>
      ) : null}
    </div>
  )
}
