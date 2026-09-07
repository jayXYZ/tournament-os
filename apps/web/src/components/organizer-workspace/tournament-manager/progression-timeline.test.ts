import { expect, test } from 'vitest'
import {
  activeRoundProgress,
  advanceAction,
  betweenRoundTarget,
  phaseSlots,
} from './progression-timeline'
import type { AdvanceStep, PhaseBoard, Round } from './progression-timeline'
import type { PairingsBoard } from './pairings-board'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'

const phaseId = 'phase' as Id<'tournamentPhases'>
const roundId = 'round' as Id<'tournamentRounds'>
// Pure projection fixtures supply only the fields these functions interpret.
const round = {
  _id: roundId,
  roundNumber: 4,
  roundStatus: 'in_progress',
} as Round
function phase(
  start: number | null,
  count: number | null,
  rounds: Array<Round> = [],
): PhaseBoard {
  return {
    phase: { _id: phaseId },
    rounds,
    timeline: { startRoundNumber: start, plannedRoundCount: count },
  } as PhaseBoard
}
function board(
  nextStep: PairingsBoard['nextStep'],
  phases: Array<PhaseBoard> = [],
): PairingsBoard {
  return {
    tournament: { lifecycle: 'in_progress' },
    phases,
    nextStep,
  } as PairingsBoard
}

test('fixed phases keep generated rounds and use server numbering for remaining slots', () => {
  expect(phaseSlots(phase(4, 3, [round]))).toEqual([
    { kind: 'round', round },
    { kind: 'planned', roundNumber: 5 },
    { kind: 'planned', roundNumber: 6 },
  ])
})
test('unresolved earlier phases leave later planned round numbers unknown', () => {
  expect(phaseSlots(phase(null, 2))).toEqual([
    { kind: 'planned', roundNumber: null },
    { kind: 'planned', roundNumber: null },
  ])
})
test('dynamic phases show one unknown slot; finished phases show no extra slot', () => {
  expect(phaseSlots(phase(4, null, [round]))).toEqual([
    { kind: 'round', round },
    { kind: 'unknown' },
  ])
  expect(phaseSlots(phase(4, 1, [round]))).toEqual([{ kind: 'round', round }])
})
test.each([
  [
    { kind: 'publishPairings', roundId, ready: true, reason: null },
    'pairingsReady',
  ],
  [
    { kind: 'completeRound', roundId, ready: false, reason: 'Missing results' },
    'playing',
  ],
  [
    { kind: 'completeRound', roundId, ready: true, reason: null },
    'readyToComplete',
  ],
  [{ kind: 'startTimer', ready: true, reason: null }, 'timerReady'],
] as const)('active round progress follows %j', (step, expected) => {
  expect(activeRoundProgress(board(step, [phase(4, 3, [round])]))).toEqual({
    roundId,
    step: expected,
  })
})
test('timer readiness without an active round and terminal states have no active progress', () => {
  expect(
    activeRoundProgress(
      board({ kind: 'startTimer', ready: true, reason: null }),
    ),
  ).toBeNull()
  expect(activeRoundProgress(board({ kind: 'tournamentCompleted' }))).toBeNull()
})
test('between rounds targets the next slot in the current phase or the next phase', () => {
  const step = { kind: 'generateNextRound', ready: true, reason: null } as const
  expect(betweenRoundTarget(board(step, [phase(4, 3, [round])]))).toEqual({
    phaseId,
    slotIndex: 1,
  })
  const next = {
    ...phase(5, null),
    phase: { ...phase(5, null).phase, _id: 'next' as Id<'tournamentPhases'> },
  }
  expect(betweenRoundTarget(board(step, [phase(4, 1, [round]), next]))).toEqual(
    { phaseId: 'next', slotIndex: 0 },
  )
  expect(betweenRoundTarget(board(step, [phase(4, 1, [round])]))).toBeNull()
  expect(betweenRoundTarget(board({ kind: 'tournamentCompleted' }))).toBeNull()
})
test.each([
  ['publishTournament', 'Registration opened'],
  ['startPlayerMeeting', 'Meeting started'],
  ['startTournament', 'Pairings generated'],
  ['publishPairings', 'Pairings published'],
  ['startTimer', 'Timer started'],
  ['completeRound', 'Round completed'],
  ['generateNextRound', 'Pairings generated'],
  ['completeTournament', 'Tournament completed'],
] as const)(
  '%s has the existing action description even while blocked',
  (kind, success) => {
    const step: AdvanceStep = {
      kind,
      phaseId,
      roundId,
      ready: false,
      reason: 'Blocked',
    }
    expect(advanceAction(step)).toMatchObject({ success })
    expect(advanceAction(step).label).toMatch(/^Hold to /)
  },
)
