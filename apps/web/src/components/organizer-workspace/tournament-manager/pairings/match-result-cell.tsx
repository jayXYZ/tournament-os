import {
  displayPlayerName,
  formatGameScoreline,
  matchResultKindLabel,
} from '@paper-pairings/core'
import type { PairingRow } from './pairing-row'
import { Badge } from '@/components/ui/badge'

export function MatchResultCell({ row }: { row: PairingRow }) {
  const playerOne = row.players.at(0)
  const playerTwo = row.players.at(1)
  if (row.match.matchStatus !== 'completed') {
    return <Badge variant="outline">Awaiting result</Badge>
  }

  const playerOneWins = playerOne?.gameWins ?? 0
  const playerTwoWins = playerOne?.isBye
    ? (playerOne.gameLosses ?? 0)
    : (playerTwo?.gameWins ?? 0)
  const gameDraws = playerOne?.gameDraws ?? 0

  if (playerOneWins === playerTwoWins) {
    return (
      <ResultWithProvenance row={row}>
        Draw {formatGameScoreline(playerOneWins, playerTwoWins, gameDraws)}
      </ResultWithProvenance>
    )
  }

  const playerOneWon = playerOneWins > playerTwoWins
  const winnerName = displayPlayerName(
    (playerOneWon ? playerOne : playerTwo)?.playerName,
  )
  const winnerWins = playerOneWon ? playerOneWins : playerTwoWins
  const loserWins = playerOneWon ? playerTwoWins : playerOneWins

  return (
    <ResultWithProvenance row={row}>
      {winnerName} wins {formatGameScoreline(winnerWins, loserWins, gameDraws)}
    </ResultWithProvenance>
  )
}

// Distinguishes awarded results from played ones and player self-reported
// results from organizer-entered ones. The scoreline alone cannot carry
// either fact: an awarded result is recorded with the scoreline the
// structure dictates, so without the kind a Concession reads as a played
// win here while the player's own card names it.
function ResultWithProvenance({
  row,
  children,
}: {
  row: PairingRow
  children: React.ReactNode
}) {
  const kindLabel = matchResultKindLabel(row.match.currentResultKind)
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{children}</span>
      {kindLabel !== null ? (
        <Badge variant="secondary">{kindLabel}</Badge>
      ) : null}
      {row.match.reportedByRegistrationId !== undefined ? (
        <Badge variant="outline">Player-reported</Badge>
      ) : null}
    </div>
  )
}
