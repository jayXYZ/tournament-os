import { expect, test } from 'vitest'
import { describeNextStep } from './next-step'
import type { PairingsBoard } from './pairings-board'

// Only the slice of the board describeNextStep reads: the step, the
// tournament's lifecycle and sizing, the field tally, and one single-phase
// round so the headline can name it.
function board(
  nextStep: PairingsBoard['nextStep'],
  roundStatus: 'in_progress' | 'completed' = 'completed',
): PairingsBoard {
  return {
    nextStep,
    tournament: {
      _id: 'tournament-a',
      lifecycle: 'in_progress',
      playerCapacity: 8,
      roundDurationMs: undefined,
    },
    field: {
      confirmed: 4,
      active: 4,
      dropped: 0,
      eliminated: 0,
      disqualified: 0,
    },
    liveRound: null,
    phases: [
      {
        phase: {
          _id: 'phase-a',
          phaseName: undefined,
          phaseType: 'swiss',
          phaseOrder: 1,
          phaseCutoff: undefined,
        },
        rounds: [
          {
            _id: 'round-1',
            tournamentPhaseId: 'phase-a',
            roundNumber: 1,
            roundStatus,
          },
        ],
        timeline: { startRoundNumber: 1, plannedRoundCount: 1 },
      },
    ],
  } as unknown as PairingsBoard
}

test('blocked publishing shows the reason instead of the generic hint', () => {
  const reason = '2 players need an opponent or a bye'
  const blocked = describeNextStep(
    board(
      {
        kind: 'publishPairings',
        ready: false,
        reason,
        roundId:
          'round-1' as PairingsBoard['phases'][number]['rounds'][number]['_id'],
      },
      'in_progress',
    ),
  )
  expect(blocked.hint).toBe(reason)
  expect(blocked.body).toBe('unpublished-pairings')

  const ready = describeNextStep(
    board(
      {
        kind: 'publishPairings',
        ready: true,
        reason: null,
        roundId:
          'round-1' as PairingsBoard['phases'][number]['rounds'][number]['_id'],
      },
      'in_progress',
    ),
  )
  expect(ready.hint).toBe(
    'Players cannot see their tables until pairings are published.',
  )
})

test('completing the tournament gets its own body, not between-rounds', () => {
  const description = describeNextStep(
    board({ kind: 'completeTournament', ready: true, reason: null }),
  )
  expect(description.body).toBe('final-round-complete')
  expect(description.headline).toBe('Final round complete')
  expect(description.hint).toBe('Posts final standings and closes the event.')

  const nextRound = describeNextStep(
    board({ kind: 'generateNextRound', ready: true, reason: null }),
  )
  expect(nextRound.body).toBe('between-rounds')
})
