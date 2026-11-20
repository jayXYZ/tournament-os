import type { FunctionReturnType } from 'convex/server'
import type { api } from '@paper-pairings/backend/convex/_generated/api'
import type { ScoreSlip } from '@/components/shared/score-slip'

export type PairingRow = FunctionReturnType<
  typeof api.tournaments.rounds.listRoundPairings
>[number]

// An organizer pairing as the shared score slip reads it: the same fields
// the public matches carry (model/publicResults.ts publicRoundMatches), so
// the organizer and public surfaces render a match identically.
export function toScoreSlip({ match, players }: PairingRow): ScoreSlip {
  return {
    matchId: match._id,
    tableNumber: match.tableNumber ?? null,
    matchStatus: match.matchStatus,
    resultKind: match.currentResultKind ?? null,
    playerReported: match.reportedByRegistrationId !== undefined,
    players: players.map((player) => ({
      name: player.playerName ?? null,
      isBye: player.isBye,
      gameWins: player.gameWins ?? null,
      gameLosses: player.gameLosses ?? null,
      gameDraws: player.gameDraws ?? null,
    })),
  }
}
