import { Link } from '@tanstack/react-router'
import { Timer } from 'lucide-react'

import {
  DEFAULT_ROUND_DURATION_MS,
  formatTimer,
} from '@paper-pairings/shared/timer-utils'

import { inProgressRound } from './pairings-board'
import type { PairingsBoard } from './pairings-board'
import { RoundTimerIndicator } from '@/components/shared/round-timer-indicator'
import { isTournamentEnded } from '@/components/tournaments'

// The tournament's timer, but only while it belongs to the round actually in
// progress. completeRound clears the timer server-side, so a mismatch is a
// transient/stale state that displays should treat as "no timer".
export function activeRoundTimer(board: PairingsBoard) {
  const timer = board.tournament.roundTimer
  if (!timer) {
    return null
  }
  const currentRound = inProgressRound(board)
  return currentRound && timer.roundId === currentRound._id ? timer : null
}

// Compact countdown in the manager's progress strip, linking to the Timer tab.
// Stays visible for the whole live tournament — before the timer starts it
// shows the configured round length in a muted "not started" state — so the
// strip's layout is stable and the timer controls are always one click away.
export function RoundTimerChip({
  board,
  publicCode,
}: {
  board: PairingsBoard
  publicCode: string
}) {
  const { lifecycle, roundDurationMs } = board.tournament
  if (isTournamentEnded(lifecycle)) {
    return null
  }
  const timer = activeRoundTimer(board)

  return (
    <Link
      to="/admin/tournaments/$tournamentId/timer"
      params={{ tournamentId: publicCode }}
      aria-label="Round timer: open timer controls"
      className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
    >
      {/* Sized on the button metrics (h-7, px-2.5) so the chip sits flush
          with the advance button beside it in the progress strip. */}
      {timer ? (
        <RoundTimerIndicator
          timer={timer}
          className="h-7 bg-background px-2.5 transition-colors hover:bg-input/50"
        />
      ) : (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-input/50">
          <Timer className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="font-normal">Not started</span>
          {formatTimer(roundDurationMs ?? DEFAULT_ROUND_DURATION_MS)}
        </span>
      )}
    </Link>
  )
}
