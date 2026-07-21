import { displayPlayerName } from '@tournament-os/core'
import type { PairingRow } from './pairing-row'
import { Badge } from '@/components/ui/badge'

export function MatchResultCell({ row }: { row: PairingRow }) {
  const playerOne = row.players.at(0)
  const playerTwo = row.players.at(1)
  const hasResult =
    row.match.matchStatus === 'completed' ||
    row.match.matchStatus === 'confirmed'

  if (!hasResult) {
    return <Badge variant="outline">Awaiting result</Badge>
  }

  const playerOneWins = playerOne?.gameWins ?? 0
  const playerTwoWins = playerOne?.isBye
    ? (playerOne.gameLosses ?? 0)
    : (playerTwo?.gameWins ?? 0)

  if (playerOneWins === playerTwoWins) {
    return (
      <ResultWithProvenance row={row}>
        Draw {playerOneWins}&ndash;{playerTwoWins}
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
      {winnerName} wins {winnerWins}&ndash;{loserWins}
    </ResultWithProvenance>
  )
}

// Distinguishes player self-reported results from organizer-entered ones, so
// the organizer can spot unconfirmed reports before completing the round.
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
      {row.match.matchStatus === 'confirmed' ? (
        <Badge variant="secondary">Confirmed by players</Badge>
      ) : row.match.reportedByRegistrationId !== undefined ? (
        <Badge variant="outline">Player-reported &middot; unconfirmed</Badge>
      ) : null}
    </div>
  )
}
