import { inProgressRound } from './pairings-board'
import type { PairingsBoard } from './pairings-board'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'

export type PhaseBoard = PairingsBoard['phases'][number]
export type Round = PhaseBoard['rounds'][number]
export type AdvanceStep = Exclude<
  PairingsBoard['nextStep'],
  { kind: 'tournamentCompleted' } | { kind: 'tournamentCancelled' }
>
export type ActiveRoundStep =
  | 'pairingsReady'
  | 'timerReady'
  | 'playing'
  | 'readyToComplete'

export type ActiveRoundProgress = {
  roundId: Id<'tournamentRounds'>
  step: ActiveRoundStep
}

export type BetweenRoundTarget = {
  phaseId: Id<'tournamentPhases'>
  slotIndex: number
}

// One node on the bar. Beyond the rounds that exist, fixed-length phases show
// their remaining planned rounds and dynamic phases show a single "?" node,
// so the bar's full width reflects the tournament's expected shape. A planned
// round's number is null when it can't be known yet (an earlier dynamic phase
// hasn't resolved its round count), in which case the node shows "?".
export type RoundSlot =
  | { kind: 'round'; round: Round }
  | { kind: 'planned'; roundNumber: number | null }
  | { kind: 'unknown' }

// Slots come from the server's timeline projection (model/phases.ts
// phaseTimelines): the engine owns the round-numbering math, this only
// shapes it into nodes. A null plannedRoundCount is an unresolved dynamic
// phase — by definition still upcoming or in progress — so it shows the
// single "?" node.
export function phaseSlots(phaseBoard: PhaseBoard): Array<RoundSlot> {
  const { rounds, timeline } = phaseBoard
  const slots: Array<RoundSlot> = rounds.map((round) => ({
    kind: 'round',
    round,
  }))

  if (timeline.plannedRoundCount !== null) {
    for (
      let index = rounds.length;
      index < timeline.plannedRoundCount;
      index++
    ) {
      slots.push({
        kind: 'planned',
        roundNumber:
          timeline.startRoundNumber === null
            ? null
            : timeline.startRoundNumber + index,
      })
    }
  } else {
    slots.push({ kind: 'unknown' })
  }

  return slots
}

// The backend's next action is also the most precise description of an active
// round's lifecycle. Keep that meaning on the node itself: the action button
// can then move around the dashboard without separating the state from the
// round it describes.
export function activeRoundProgress(
  board: PairingsBoard,
): ActiveRoundProgress | null {
  const { nextStep } = board
  if (nextStep.kind === 'publishPairings') {
    return { roundId: nextStep.roundId, step: 'pairingsReady' }
  }
  if (nextStep.kind === 'completeRound') {
    return {
      roundId: nextStep.roundId,
      step: nextStep.ready ? 'readyToComplete' : 'playing',
    }
  }
  if (nextStep.kind !== 'startTimer') {
    return null
  }

  const activeRound = inProgressRound(board)
  return activeRound ? { roundId: activeRound._id, step: 'timerReady' } : null
}

// Once a completed round is waiting for the next one to be generated, the
// next planned slot becomes the bar's current step. This works within a phase
// and across phase boundaries, including dynamic phases whose node is "?".
export function betweenRoundTarget(
  board: PairingsBoard,
): BetweenRoundTarget | null {
  const betweenRounds =
    board.tournament.lifecycle === 'in_progress' &&
    board.nextStep.kind === 'generateNextRound'
  if (!betweenRounds) {
    return null
  }

  let lastRoundPhaseIndex = -1
  for (const [index, phaseBoard] of board.phases.entries()) {
    if (phaseBoard.rounds.length > 0) {
      lastRoundPhaseIndex = index
    }
  }

  for (
    let phaseIndex = Math.max(lastRoundPhaseIndex, 0);
    phaseIndex < board.phases.length;
    phaseIndex++
  ) {
    const phaseBoard = board.phases[phaseIndex]
    const slots = phaseSlots(phaseBoard)
    const slotIndex = slots.findIndex((slot) => slot.kind !== 'round')
    if (slotIndex !== -1) {
      return { phaseId: phaseBoard.phase._id, slotIndex }
    }
  }

  return null
}

// Success copy is shown on the button itself while it is still sized for
// the idle label, so keep it shorter than the matching "Hold to" label.
export function advanceAction(advanceStep: AdvanceStep) {
  switch (advanceStep.kind) {
    case 'publishTournament':
      return {
        label: 'Hold to publish and open registration',
        icon: 'Globe' as const,
        success: 'Registration opened',
      }
    case 'startPlayerMeeting':
      return {
        label: 'Hold to start player meeting',
        icon: 'Users' as const,
        success: 'Meeting started',
      }
    case 'startTournament':
      return {
        label: 'Hold to generate pairings',
        icon: 'Swords' as const,
        success: 'Pairings generated',
      }
    case 'publishPairings':
      return {
        label: 'Hold to publish pairings',
        icon: 'Send' as const,
        success: 'Pairings published',
      }
    case 'startTimer':
      return {
        label: 'Hold to start round timer',
        icon: 'TimerIcon' as const,
        success: 'Timer started',
      }
    case 'completeRound':
      return {
        label: 'Hold to complete round and post standings',
        icon: 'ListOrdered' as const,
        success: 'Round completed',
      }
    case 'generateNextRound':
      return {
        label: 'Hold to generate pairings',
        icon: 'Swords' as const,
        success: 'Pairings generated',
      }
    case 'completeTournament':
      return {
        label: 'Hold to complete tournament',
        icon: 'Trophy' as const,
        success: 'Tournament completed',
      }
  }
}
