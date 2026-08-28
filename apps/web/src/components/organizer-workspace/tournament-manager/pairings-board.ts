import type { FunctionReturnType } from 'convex/server'
import type { api } from '@tournament-os/backend/convex/_generated/api'

export type PairingsBoard = FunctionReturnType<
  typeof api.tournaments.rounds.getPairingsBoard
>

// The round currently being played, across all phases. At most one round is
// ever in progress at a time.
export function inProgressRound(board: PairingsBoard) {
  return board.phases
    .flatMap((phaseBoard) => phaseBoard.rounds)
    .find((round) => round.roundStatus === 'in_progress')
}
