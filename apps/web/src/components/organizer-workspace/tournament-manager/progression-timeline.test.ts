import { describe, expect, test } from 'vitest'
import {
  activeRoundProgress,
  advanceAction,
  betweenRoundTarget,
  phaseSlots,
} from './progression-timeline'
import type { AdvanceStep, PhaseBoard, Round } from './progression-timeline'
import type { PairingsBoard } from './pairings-board'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'

// Pure projection fixtures supply only the board fields these functions (and
// describeNextStep, which advanceAction reads) interpret.
const swissId = 'phase-swiss' as Id<'tournamentPhases'>
const topId = 'phase-top' as Id<'tournamentPhases'>
const finalId = 'phase-final' as Id<'tournamentPhases'>
const roundId = 'round-4' as Id<'tournamentRounds'>

function round(
  roundNumber: number,
  roundStatus: Round['roundStatus'],
  tournamentPhaseId: Id<'tournamentPhases'> = swissId,
): Round {
  return {
    _id: `round-${roundNumber}` as Id<'tournamentRounds'>,
    tournamentPhaseId,
    roundNumber,
    roundName: `Round ${roundNumber}`,
    roundStatus,
  } as Round
}

function phase(
  timeline: PhaseBoard['timeline'],
  rounds: Array<Round> = [],
  _id: Id<'tournamentPhases'> = swissId,
): PhaseBoard {
  return {
    phase: {
      _id,
      phaseName: undefined,
      phaseType: 'swiss',
      phaseOrder: 1,
      phaseCutoff: undefined,
    },
    rounds,
    timeline,
  } as unknown as PhaseBoard
}

function board(
  nextStep: PairingsBoard['nextStep'],
  phases: Array<PhaseBoard> = [],
  overrides: Partial<Pick<PairingsBoard, 'liveRound'>> & {
    lifecycle?: PairingsBoard['tournament']['lifecycle']
  } = {},
): PairingsBoard {
  return {
    nextStep,
    tournament: {
      _id: 'tournament-a',
      lifecycle: overrides.lifecycle ?? 'in_progress',
      playerCapacity: 16,
      roundDurationMs: undefined,
    },
    field: {
      confirmed: 15,
      active: 15,
      dropped: 0,
      eliminated: 0,
      disqualified: 0,
    },
    liveRound: overrides.liveRound ?? null,
    phases,
  } as unknown as PairingsBoard
}

describe('phaseSlots', () => {
  test('fixed phases keep generated rounds and use server numbering for remaining slots', () => {
    const current = round(4, 'in_progress')
    expect(
      phaseSlots(
        phase({ startRoundNumber: 4, plannedRoundCount: 3 }, [current]),
      ),
    ).toEqual([
      { kind: 'round', round: current },
      { kind: 'planned', roundNumber: 5 },
      { kind: 'planned', roundNumber: 6 },
    ])
  })

  test('a fully played fixed phase shows no extra slot', () => {
    const last = round(4, 'completed')
    expect(
      phaseSlots(phase({ startRoundNumber: 4, plannedRoundCount: 1 }, [last])),
    ).toEqual([{ kind: 'round', round: last }])
  })

  test('dynamic phases show one unresolved node after their rounds', () => {
    const first = round(4, 'completed')
    expect(
      phaseSlots(
        phase({ startRoundNumber: 4, plannedRoundCount: null }, [first]),
      ),
    ).toEqual([{ kind: 'round', round: first }, { kind: 'unknown' }])
    expect(
      phaseSlots(phase({ startRoundNumber: null, plannedRoundCount: null })),
    ).toEqual([{ kind: 'unknown' }])
  })

  test('unresolved earlier phases leave later planned round numbers unknown', () => {
    expect(
      phaseSlots(phase({ startRoundNumber: null, plannedRoundCount: 2 })),
    ).toEqual([
      { kind: 'planned', roundNumber: null },
      { kind: 'planned', roundNumber: null },
    ])
  })

  test('a multi-phase event lays out each phase from its own timeline', () => {
    const swiss = [round(1, 'completed'), round(2, 'in_progress')]
    const phases = [
      phase({ startRoundNumber: 1, plannedRoundCount: 3 }, swiss),
      phase({ startRoundNumber: 4, plannedRoundCount: null }, [], topId),
      phase({ startRoundNumber: null, plannedRoundCount: 1 }, [], finalId),
    ]
    expect(phases.map(phaseSlots)).toEqual([
      [
        { kind: 'round', round: swiss[0] },
        { kind: 'round', round: swiss[1] },
        { kind: 'planned', roundNumber: 3 },
      ],
      [{ kind: 'unknown' }],
      [{ kind: 'planned', roundNumber: null }],
    ])
  })
})

describe('activeRoundProgress', () => {
  const playing = phase({ startRoundNumber: 4, plannedRoundCount: 3 }, [
    round(4, 'in_progress'),
  ])

  test.each([
    [
      { kind: 'publishPairings', roundId, ready: true, reason: null },
      'pairingsReady',
    ],
    [
      {
        kind: 'completeRound',
        roundId,
        ready: false,
        reason: '3 matches still need a result',
      },
      'playing',
    ],
    [
      { kind: 'completeRound', roundId, ready: true, reason: null },
      'readyToComplete',
    ],
    [{ kind: 'startTimer', ready: true, reason: null }, 'timerReady'],
  ] as const)('%j puts the active round at %s', (step, expected) => {
    expect(activeRoundProgress(board(step, [playing]))).toEqual({
      roundId,
      step: expected,
    })
  })

  test('the timer step finds the in-progress round in any phase', () => {
    const phases = [
      phase({ startRoundNumber: 1, plannedRoundCount: 3 }, [
        round(1, 'completed'),
        round(2, 'completed'),
        round(3, 'completed'),
      ]),
      phase(
        { startRoundNumber: 4, plannedRoundCount: 3 },
        [round(4, 'in_progress', topId)],
        topId,
      ),
    ]
    expect(
      activeRoundProgress(
        board({ kind: 'startTimer', ready: true, reason: null }, phases),
      ),
    ).toEqual({ roundId, step: 'timerReady' })
  })

  test('the timer step without an in-progress round has no active progress', () => {
    expect(
      activeRoundProgress(
        board({ kind: 'startTimer', ready: true, reason: null }),
      ),
    ).toBeNull()
  })

  test.each([
    { kind: 'generateNextRound', ready: true, reason: null },
    { kind: 'startPlayerMeeting', ready: true, reason: null, phaseId: topId },
    { kind: 'completeTournament', ready: true, reason: null },
    { kind: 'tournamentCompleted' },
    { kind: 'tournamentCancelled' },
  ] as const)('%j has no active round', (step) => {
    expect(activeRoundProgress(board(step, [playing]))).toBeNull()
  })
})

describe('betweenRoundTarget', () => {
  const generate = {
    kind: 'generateNextRound',
    ready: true,
    reason: null,
  } as const

  test('targets the next slot within the current phase', () => {
    const phases = [
      phase({ startRoundNumber: 1, plannedRoundCount: 3 }, [
        round(1, 'completed'),
      ]),
    ]
    expect(betweenRoundTarget(board(generate, phases))).toEqual({
      phaseId: swissId,
      slotIndex: 1,
    })
  })

  test('crosses into the next phase, including an unresolved dynamic one', () => {
    const swiss = phase({ startRoundNumber: 1, plannedRoundCount: 1 }, [
      round(1, 'completed'),
    ])
    expect(
      betweenRoundTarget(
        board(generate, [
          swiss,
          phase({ startRoundNumber: 2, plannedRoundCount: 3 }, [], topId),
        ]),
      ),
    ).toEqual({ phaseId: topId, slotIndex: 0 })
    expect(
      betweenRoundTarget(
        board(generate, [
          swiss,
          phase({ startRoundNumber: 2, plannedRoundCount: null }, [], topId),
        ]),
      ),
    ).toEqual({ phaseId: topId, slotIndex: 0 })
  })

  test('searches from the latest phase with rounds, not earlier open slots', () => {
    const phases = [
      phase({ startRoundNumber: 1, plannedRoundCount: 3 }, [
        round(1, 'completed'),
      ]),
      phase(
        { startRoundNumber: 4, plannedRoundCount: 2 },
        [round(4, 'completed', topId)],
        topId,
      ),
    ]
    expect(betweenRoundTarget(board(generate, phases))).toEqual({
      phaseId: topId,
      slotIndex: 1,
    })
  })

  test('starts from the first phase before any round exists', () => {
    const phases = [
      phase({ startRoundNumber: 1, plannedRoundCount: 3 }),
      phase({ startRoundNumber: 4, plannedRoundCount: 2 }, [], topId),
    ]
    expect(betweenRoundTarget(board(generate, phases))).toEqual({
      phaseId: swissId,
      slotIndex: 0,
    })
  })

  test('has no target once every planned slot is a round', () => {
    const phases = [
      phase({ startRoundNumber: 1, plannedRoundCount: 1 }, [
        round(1, 'completed'),
      ]),
    ]
    expect(betweenRoundTarget(board(generate, phases))).toBeNull()
  })

  test('only applies while the event is in progress and waiting on a round', () => {
    const phases = [
      phase({ startRoundNumber: 1, plannedRoundCount: 3 }, [
        round(1, 'completed'),
      ]),
    ]
    expect(
      betweenRoundTarget(board(generate, phases, { lifecycle: 'completed' })),
    ).toBeNull()
    expect(
      betweenRoundTarget(
        board(
          { kind: 'completeTournament', ready: true, reason: null },
          phases,
        ),
      ),
    ).toBeNull()
    expect(
      betweenRoundTarget(board({ kind: 'tournamentCompleted' }, phases)),
    ).toBeNull()
  })
})

describe('advanceAction', () => {
  const phases = [
    phase({ startRoundNumber: 1, plannedRoundCount: 3 }, [
      round(1, 'completed'),
      round(2, 'in_progress'),
    ]),
  ]
  const roundTwo = 'round-2' as Id<'tournamentRounds'>

  function step(kind: AdvanceStep['kind'], ready: boolean): AdvanceStep {
    return {
      kind,
      ready,
      reason: ready ? null : 'Blocked for a reason',
      phaseId: swissId,
      roundId: roundTwo,
    }
  }

  test.each([
    [
      'publishTournament',
      'Hold to publish and open registration',
      'Registration opened',
      true,
    ],
    [
      'startPlayerMeeting',
      'Hold to start player meeting',
      'Meeting started',
      true,
    ],
    [
      'startTournament',
      'Hold to generate pairings',
      'Pairings generated',
      true,
    ],
    ['publishPairings', 'Hold to publish pairings', 'Pairings published', true],
    ['startTimer', 'Hold to start round timer', 'Timer started', false],
    [
      'completeRound',
      'Hold to complete round and post standings',
      'Round completed',
      true,
    ],
    [
      'generateNextRound',
      'Hold to generate pairings',
      'Pairings generated',
      true,
    ],
    [
      'completeTournament',
      'Hold to complete tournament',
      'Tournament completed',
      true,
    ],
  ] as const)(
    'a ready %s holds to its verb in both densities',
    (kind, label, successLabel, resetsRoundSelection) => {
      const ready = step(kind, true)
      for (const density of ['compact', 'expanded'] as const) {
        expect(advanceAction(board(ready, phases), density)).toEqual({
          kind: 'advance',
          step: ready,
          label,
          successLabel,
          title: undefined,
          resetsRoundSelection,
        })
      }
    },
  )

  test('a blocked step keeps its verb expanded, where the band shows the hint', () => {
    const blocked = step('generateNextRound', false)
    expect(advanceAction(board(blocked, phases), 'expanded')).toMatchObject({
      label: 'Hold to generate pairings',
      title: undefined,
    })
  })

  test('a blocked step shows its reason on the compact face and the hint as its title', () => {
    const blocked = step('generateNextRound', false)
    expect(advanceAction(board(blocked, phases), 'compact')).toMatchObject({
      label: 'Blocked for a reason',
      title: 'Blocked for a reason',
    })
  })

  test('a blocked round completion counts results on the compact face', () => {
    const blocked = step('completeRound', false)
    const liveRound = {
      roundId: roundTwo,
      roundNumber: 2,
      tableCount: 15,
      byeCount: 1,
      resultsIn: 9,
      unconfirmedCount: 0,
    }
    expect(
      advanceAction(board(blocked, phases, { liveRound }), 'compact'),
    ).toMatchObject({
      label: '9 of 15 results in',
      title: 'Available once all 15 results are in.',
    })
    expect(
      advanceAction(board(blocked, phases, { liveRound }), 'expanded'),
    ).toMatchObject({
      label: 'Hold to complete round and post standings',
      title: undefined,
    })
  })

  test('a blocked step without a reason falls back to its verb', () => {
    const blocked = { ...step('publishTournament', false), reason: null }
    expect(advanceAction(board(blocked, phases), 'compact')).toMatchObject({
      label: 'Hold to publish and open registration',
      title: undefined,
    })
  })

  test.each(['tournamentCompleted', 'tournamentCancelled'] as const)(
    '%s has no action left',
    (kind) => {
      expect(advanceAction(board({ kind }, phases), 'compact')).toEqual({
        kind,
      })
    },
  )
})
