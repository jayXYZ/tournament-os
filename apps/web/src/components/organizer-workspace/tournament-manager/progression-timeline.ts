import { describeNextStep } from './next-step'
import { inProgressRound } from './pairings-board'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { PairingsBoard } from './pairings-board'

// The tournament timeline as the progress bar draws it: which round slots each
// phase shows, where the tournament currently is, and what the one advance
// action says. Plain functions over the pairings board, so a second timeline
// or advance surface reads the same answers instead of re-deriving them.

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

// The strip has two densities. Compact is the global layer on every
// tournament route: the timeline, the timer chip, and the advance button in
// one row, where the timeline is also the round selector for Pairings and
// Standings. Expanded is the overview: the live status band (round, clock,
// results, the advance button at full size with its hint) above the
// timeline, and no chip, because the band already shows the time. Same
// component and same board data, so the two can never disagree.
export type ProgressBarDensity = 'compact' | 'expanded'

// One node on the bar. Beyond the rounds that exist, fixed-length phases show
// their remaining planned rounds and dynamic phases show a single unresolved
// node, so the bar's full width reflects the tournament's expected shape. A
// planned round's number is null when it can't be known yet (an earlier
// dynamic phase hasn't resolved its round count).
export type RoundSlot =
  | { kind: 'round'; round: Round }
  | { kind: 'planned'; roundNumber: number | null }
  | { kind: 'unknown' }

// Slots come from the server's timeline projection (model/phases.ts
// phaseTimelines): the engine owns the round-numbering math, this only
// shapes it into nodes. A null plannedRoundCount is an unresolved dynamic
// phase — by definition still upcoming or in progress — so it shows the
// single unresolved node.
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

// The accent carries "this round is in play"; the two pre-play steps keep
// their own hue because they are waiting on the organizer, not the players.
// Filled accent means the round can be completed now.
export const activeRoundStepPresentation: Record<
  ActiveRoundStep,
  { label: string; tooltip: string; className: string }
> = {
  pairingsReady: {
    label: 'pairings ready to publish',
    tooltip: 'Pairings ready to publish',
    className:
      'border-round-pairings bg-round-pairings/10 text-round-pairings ring-2 ring-round-pairings/20 hover:bg-round-pairings/20',
  },
  timerReady: {
    label: 'pairings published; timer not started',
    tooltip: 'Pairings published · Timer not started',
    className:
      'border-round-timer bg-round-timer/10 text-round-timer ring-2 ring-round-timer/20 hover:bg-round-timer/20',
  },
  playing: {
    label: 'round in progress',
    tooltip: 'Round in progress',
    className:
      'border-accent-brand bg-accent-brand/10 text-accent-brand ring-2 ring-accent-brand/20 hover:bg-accent-brand/20',
  },
  readyToComplete: {
    label: 'results reported; ready to complete',
    tooltip: 'Results reported · Ready to complete',
    className:
      'border-accent-brand bg-accent-brand text-accent-brand-foreground ring-2 ring-accent-brand/25 hover:bg-accent-brand/90',
  },
}

// Once a completed round is waiting for the next one to be generated, the
// next planned slot becomes the bar's current step. This works within a phase
// and across phase boundaries, including dynamic phases whose node is
// unresolved.
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

// What the advance control shows for the board's next step. A finished or
// cancelled tournament has no action left, only its terminal state.
export type AdvanceAction =
  | { kind: 'tournamentCancelled' }
  | { kind: 'tournamentCompleted' }
  | {
      kind: 'advance'
      step: AdvanceStep
      label: string
      successLabel: string
      // The full hint, as the compact face's tooltip while it is blocked.
      title: string | undefined
      // Whether a successful advance clears the organizer's round selection
      // so the views fall back to the newly current round.
      resetsRoundSelection: boolean
    }

// The label, success flash, and hint come from describeNextStep so the
// button says the same thing as the band and the overview body. The icon and
// the mutation are the button's own choice.
export function advanceAction(
  board: PairingsBoard,
  density: ProgressBarDensity,
): AdvanceAction {
  const step = board.nextStep
  if (
    step.kind === 'tournamentCancelled' ||
    step.kind === 'tournamentCompleted'
  ) {
    return { kind: step.kind }
  }

  const description = describeNextStep(board)

  // Expanded, the face keeps its verb and the band prints the hint beneath
  // it. Compact has no room for a second line, so a blocked button carries
  // its short reason on the face ("9 of 15 results in") and the full hint
  // as its title.
  const compactBlockedLabel =
    step.kind === 'completeRound' && board.liveRound
      ? `${board.liveRound.resultsIn} of ${board.liveRound.tableCount} results in`
      : (step.reason ?? description.actionLabel)

  return {
    kind: 'advance',
    step,
    label:
      density === 'expanded' || step.ready
        ? description.actionLabel
        : compactBlockedLabel,
    successLabel: description.successLabel,
    title:
      density === 'compact' && !step.ready
        ? (description.hint ?? undefined)
        : undefined,
    // Starting the timer doesn't change which round is current, so keep
    // whatever round the organizer is viewing instead of resetting it.
    resetsRoundSelection: step.kind !== 'startTimer',
  }
}
