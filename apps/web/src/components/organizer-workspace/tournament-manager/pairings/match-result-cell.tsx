import { displayPlayerName, formatGameScoreline } from '@tournament-os/core'
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

// Distinguishes player self-reported results from organizer-entered ones, so
// the organizer knows which results players entered themselves.
function ResultWithProvenance({
  row,
  children,
}: {
  row: PairingRow
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{children}</span>
      {row.match.reportedByRegistrationId !== undefined ? (
        <Badge variant="outline">Player-reported</Badge>
      ) : null}
    </div>
  )
}
