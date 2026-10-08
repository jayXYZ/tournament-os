import {
  displayPlayerName,
  formatGameScoreline,
  matchResultKindLabel,
} from '@paper-pairings/core'
import type { PairingRow } from './pairing-row'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

// The score slip is the one piece of paper every organizer already knows:
// a table number, two names, and a result box that is empty until someone
// writes in it. These pieces are that slip's vocabulary, shared by the
// Pairings table and the overview's ledger so a match reads the same
// everywhere.

export function ScoreSlipTable({ row }: { row: PairingRow }) {
  return (
    <span className="font-mono text-sm font-medium tabular-nums">
      {row.match.tableNumber ?? (
        <span className="text-muted-foreground">Bye</span>
      )}
    </span>
  )
}

export function ScoreSlipPlayers({
  row,
  layout = 'stacked',
}: {
  row: PairingRow
  layout?: 'stacked' | 'inline'
}) {
  const playerOne = row.players.at(0)
  const playerTwo = row.players.at(1)
  const isBye = row.players.some((player) => player.isBye)

  if (layout === 'inline') {
    return (
      <span className="font-medium text-foreground">
        {displayPlayerName(playerOne?.playerName)}
        {isBye ? (
          <span className="font-normal text-muted-foreground">
            {' '}
            has the bye
          </span>
        ) : (
          <>
            <span className="font-normal text-muted-foreground"> vs </span>
            {displayPlayerName(playerTwo?.playerName)}
          </>
        )}
      </span>
    )
  }

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

// The result box. Empty and dashed until a result exists; then the scoreline
// with its provenance, because the scoreline alone cannot say whether a
// result was played, awarded, or reported by a player and not yet confirmed.
export function ScoreSlipResult({
  row,
  className,
}: {
  row: PairingRow
  className?: string
}) {
  const playerOne = row.players.at(0)
  const playerTwo = row.players.at(1)
  if (row.match.matchStatus !== 'completed') {
    return (
      <span
        aria-label="Awaiting result"
        className={cn(
          'inline-flex h-6 min-w-14 items-center justify-center rounded-sm border border-dashed border-muted-foreground/50 text-xs text-muted-foreground',
          className,
        )}
      >
        Awaiting
      </span>
    )
  }

  const playerOneWins = playerOne?.gameWins ?? 0
  const playerTwoWins = playerOne?.isBye
    ? (playerOne.gameLosses ?? 0)
    : (playerTwo?.gameWins ?? 0)
  const gameDraws = playerOne?.gameDraws ?? 0
  const kindLabel = matchResultKindLabel(row.match.currentResultKind)
  const unconfirmed = row.match.reportedByRegistrationId !== undefined

  let summary: string
  if (playerOneWins === playerTwoWins) {
    summary = `Draw ${formatGameScoreline(playerOneWins, playerTwoWins, gameDraws)}`
  } else {
    const playerOneWon = playerOneWins > playerTwoWins
    const winnerName = displayPlayerName(
      (playerOneWon ? playerOne : playerTwo)?.playerName,
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
      {unconfirmed ? <Badge variant="outline">Player-reported</Badge> : null}
    </div>
  )
}
