import {
  DEFAULT_ROUND_DURATION_MS,
  formatTimer,
} from '@paper-pairings/shared/timer-utils'

import { inProgressRound } from './pairings-board'
import { phaseLabel } from './phase-label'
import type { PairingsBoard } from './pairings-board'

// What the overview's body lists for the tournament's current state.
export type OverviewBody =
  | 'setup'
  | 'registration'
  | 'unpublished-pairings'
  | 'live'
  | 'between-rounds'
  | 'finished'
  | 'cancelled'

export type NextStepDescription = {
  // The state the live band leads with: "Round 3 of 5", "Not published".
  headline: string
  // The one primary action's hold label and the success flash it shows.
  actionLabel: string
  successLabel: string
  // What the action will do, or what is holding it back. Shown beneath the
  // button in the expanded band; the compact strip folds it into a title.
  hint: string | null
  body: OverviewBody
}

// The board's nextStep is the one value that may speak for the tournament's
// state: the advance button already reads it, and the overview's headline,
// hint, and body read this same projection, so the page can never contradict
// itself (a running timer beside "the event has not begun"). Presentation
// only — nothing here re-derives readiness.
export function describeNextStep(board: PairingsBoard): NextStepDescription {
  const { nextStep: step, tournament, field, liveRound } = board
  const roundHeadline = describeCurrentRound(board)

  switch (step.kind) {
    case 'publishTournament':
      return {
        headline: 'Not published',
        actionLabel: 'Hold to publish and open registration',
        successLabel: 'Registration opened',
        hint: step.ready
          ? 'Nobody can register until the event is published.'
          : step.reason,
        body: 'setup',
      }
    case 'startPlayerMeeting':
      return {
        headline: `Registration open, ${field.confirmed} of ${tournament.playerCapacity}`,
        actionLabel: 'Hold to start player meeting',
        successLabel: 'Meeting started',
        hint: step.ready
          ? 'Seats the field alphabetically. Players see their seat while the meeting is live.'
          : step.reason,
        body:
          tournament.lifecycle === 'in_progress'
            ? 'between-rounds'
            : 'registration',
      }
    case 'startTournament':
      return {
        headline:
          tournament.lifecycle === 'registration'
            ? `Registration open, ${field.confirmed} of ${tournament.playerCapacity}`
            : 'Ready to pair round 1',
        actionLabel: 'Hold to generate pairings',
        successLabel: 'Pairings generated',
        hint: step.ready
          ? `Pairs round 1 for ${field.active} ${field.active === 1 ? 'player' : 'players'} and starts the event.`
          : step.reason,
        body: 'registration',
      }
    case 'publishPairings':
      return {
        headline: `${roundHeadline} paired`,
        actionLabel: 'Hold to publish pairings',
        successLabel: 'Pairings published',
        hint: 'Players cannot see their tables until pairings are published.',
        body: 'unpublished-pairings',
      }
    case 'startTimer':
      return {
        headline: roundHeadline,
        actionLabel: 'Hold to start round timer',
        successLabel: 'Timer started',
        hint: `${formatTimer(tournament.roundDurationMs ?? DEFAULT_ROUND_DURATION_MS)} round. Results can be entered before the timer starts.`,
        body: 'live',
      }
    case 'completeRound':
      return {
        headline: roundHeadline,
        actionLabel: 'Hold to complete round and post standings',
        successLabel: 'Round completed',
        hint: step.ready
          ? 'All results are in. Posts standings and readies the next round.'
          : liveRound
            ? `Available once all ${liveRound.tableCount} results are in.`
            : step.reason,
        body: 'live',
      }
    case 'generateNextRound':
      return {
        headline: `${roundHeadline} complete`,
        actionLabel: 'Hold to generate pairings',
        successLabel: 'Pairings generated',
        hint: step.ready
          ? 'Pairs the next round from the posted standings.'
          : step.reason,
        body: 'between-rounds',
      }
    case 'completeTournament':
      return {
        headline: 'Final round complete',
        actionLabel: 'Hold to complete tournament',
        successLabel: 'Tournament completed',
        hint: step.ready
          ? 'Posts final standings and closes the event.'
          : step.reason,
        body: 'between-rounds',
      }
    case 'tournamentCompleted':
      return {
        headline: 'Finished',
        actionLabel: 'Tournament complete',
        successLabel: 'Tournament complete',
        hint: null,
        body: 'finished',
      }
    case 'tournamentCancelled':
      return {
        headline: 'Cancelled',
        actionLabel: 'Tournament cancelled',
        successLabel: 'Tournament cancelled',
        hint: null,
        body: 'cancelled',
      }
  }
}

// "Round 3 of 5" for a single-phase event; "Swiss, round 3 of 5" once phases
// need naming. Round numbers are global across the tournament, so a phase's
// position is counted from its timeline start (model/phases.ts). Falls back
// to the latest round when nothing is in progress (between rounds).
export function describeCurrentRound(board: PairingsBoard) {
  const round =
    inProgressRound(board) ??
    board.phases.flatMap((phaseBoard) => phaseBoard.rounds).at(-1)
  if (!round) {
    return 'Round 1'
  }
  const phaseIndex = board.phases.findIndex(
    (phaseBoard) => phaseBoard.phase._id === round.tournamentPhaseId,
  )
  const phaseBoard = board.phases[phaseIndex]
  const start = phaseBoard.timeline.startRoundNumber ?? round.roundNumber
  const planned = phaseBoard.timeline.plannedRoundCount
  const roundInPhase = round.roundNumber - start + 1
  const label = phaseLabel(
    phaseBoard.phase,
    phaseIndex > 0 ? board.phases[phaseIndex - 1].phase : undefined,
  )
  const position =
    planned === null
      ? `round ${roundInPhase}`
      : `round ${roundInPhase} of ${planned}`
  if (board.phases.length === 1) {
    return position.replace('round', 'Round')
  }
  return `${label}, ${position}`
}
