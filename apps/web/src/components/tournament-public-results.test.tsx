// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { getFunctionName } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { FunctionReference } from 'convex/server'
import type { Root } from 'react-dom/client'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'

// The event page's Public Results section (tournament-public-results.tsx):
// what it renders for each lifecycle and query answer, and which round it
// asks the server for as the viewer steps between rounds. Convex's useQuery
// is stubbed at its seam and records the arguments of every call.

const state = vi.hoisted(() => {
  const answers: {
    standings: unknown
    matches: (args: { roundId?: string }) => unknown
    calls: Array<{ name: string; args: unknown }>
  } = { standings: undefined, matches: () => undefined, calls: [] }
  return answers
})

vi.mock('convex/react', () => ({
  useQuery: (query: FunctionReference<'query'>, args: unknown) => {
    const name = getFunctionName(query)
    state.calls.push({ name, args })
    if (name === 'tournaments/publicResults:getPublicStandings') {
      return state.standings
    }
    if (name === 'tournaments/publicResults:getPublicMatches') {
      return state.matches(args as { roundId?: string })
    }
    throw new Error(`Unexpected query ${name}`)
  },
}))

const { TournamentPublicResults } = await import('./tournament-public-results')

const roundId = (n: number) => `round-${n}` as Id<'tournamentRounds'>
const matchId = (n: number) => `match-${n}` as Id<'tournamentMatches'>

function player(name: string, gameWins: number | null = null) {
  return {
    name,
    isBye: false,
    gameWins,
    gameLosses: null,
    gameDraws: gameWins === null ? null : 0,
  }
}

function matchesFor(selected: number, roundCount = 2) {
  return {
    phases: [
      {
        phaseOrder: 1,
        phaseName: 'Phase 1',
        phaseType: 'swiss',
        rounds: Array.from({ length: roundCount }, (_, index) => ({
          roundId: roundId(index + 1),
          roundNumber: index + 1,
          roundName: `Round ${index + 1}`,
          roundStatus: index + 1 < roundCount ? 'completed' : 'in_progress',
        })),
      },
    ],
    round: {
      roundId: roundId(selected),
      roundNumber: selected,
      roundName: `Round ${selected}`,
      roundStatus: selected < roundCount ? 'completed' : 'in_progress',
      phaseOrder: 1,
      phaseType: 'swiss',
    },
    matches: [
      {
        matchId: matchId(1),
        tableNumber: 1,
        matchStatus: 'completed',
        resultKind: 'played',
        playerReported: true,
        players: [player('Ada', 2), player('Brook', 1)],
      },
      {
        matchId: matchId(2),
        tableNumber: 2,
        matchStatus: 'upcoming',
        resultKind: null,
        playerReported: false,
        players: [player('Cal'), player('Dee')],
      },
      {
        matchId: matchId(3),
        tableNumber: null,
        matchStatus: 'completed',
        resultKind: 'bye',
        playerReported: false,
        players: [
          {
            name: 'Eve',
            isBye: true,
            gameWins: 2,
            gameLosses: 0,
            gameDraws: 0,
          },
        ],
      },
    ],
  }
}

const standings = {
  standings: {
    roundNumber: 1,
    roundName: 'Round 1',
    rows: [
      {
        rank: 1,
        name: 'Ada',
        matchPoints: 3,
        matchWins: 1,
        matchLosses: 0,
        matchDraws: 0,
        opponentMatchWinPct: 0.33,
        gameWinPct: 0.667,
        opponentGameWinPct: 0.4,
        playoffStatus: 'not_started',
        eliminatedInRoundNumber: null,
        registrationStatus: 'active',
      },
      {
        rank: 2,
        name: 'Brook',
        matchPoints: 0,
        matchWins: 0,
        matchLosses: 1,
        matchDraws: 0,
        opponentMatchWinPct: 1,
        gameWinPct: 0.333,
        opponentGameWinPct: 0.6,
        playoffStatus: 'not_started',
        eliminatedInRoundNumber: null,
        registrationStatus: 'dropped',
      },
    ],
  },
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  state.calls = []
  state.standings = undefined
  state.matches = () => undefined
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

function render(
  lifecycle: 'registration' | 'in_progress' | 'completed' | 'cancelled',
) {
  act(() => {
    root.render(
      <TournamentPublicResults
        publicCode="7K3M9Q"
        inviteCode="ABCDEFGHJK"
        lifecycle={lifecycle}
      />,
    )
  })
}

const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
const text = () => clean(container.textContent)

function rows() {
  return Array.from(container.querySelectorAll('li')).map((item) =>
    clean(item.textContent),
  )
}

function button(label: string) {
  const found = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  )
  if (!found) throw new Error(`${label} button not found`)
  return found
}

describe('before the event starts', () => {
  test('says where results will appear and asks the server for nothing', () => {
    render('registration')
    expect(text()).toContain(
      'They appear here once the event begins, and update live as results come in.',
    )
    expect(state.calls).toEqual([])
  })
})

describe('matches', () => {
  test('a live event opens on the latest round, with each match as a score slip', () => {
    state.matches = () => matchesFor(2)
    render('in_progress')

    expect(state.calls.at(-1)).toEqual({
      name: 'tournaments/publicResults:getPublicMatches',
      args: {
        publicCode: '7K3M9Q',
        inviteCode: 'ABCDEFGHJK',
        roundId: undefined,
      },
    })
    expect(text()).toContain('Round 2')
    expect(text()).toContain('2 of 2 rounds')
    expect(text()).toContain('In progress')
    expect(rows()).toEqual([
      '1Ada vs BrookAda wins 2–1Player-reported',
      '2Cal vs DeeAwaiting',
      'ByeEve has the byeEve wins 2–0',
    ])
    expect(button('Next round').disabled).toBe(true)
  })

  test('stepping back asks for the earlier round, and forward returns to following the latest', () => {
    state.matches = (args) => matchesFor(args.roundId === roundId(1) ? 1 : 2)
    render('in_progress')

    act(() => button('Previous round').click())
    expect(state.calls.at(-1)?.args).toMatchObject({ roundId: roundId(1) })
    expect(text()).toContain('1 of 2 rounds')
    expect(text()).toContain('Finished')

    act(() => button('Next round').click())
    expect(state.calls.at(-1)?.args).toMatchObject({ roundId: undefined })
    expect(text()).toContain('2 of 2 rounds')
  })

  test('holds the previous round on screen while the next one loads', () => {
    state.matches = (args) =>
      args.roundId === roundId(1) ? undefined : matchesFor(2)
    render('in_progress')

    act(() => button('Previous round').click())
    expect(text()).toContain('Round 2')
    expect(rows()).toHaveLength(3)
  })

  test('the player search narrows the list by name', () => {
    state.matches = () => matchesFor(2)
    render('in_progress')
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Find a player"]',
    )!
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!
      setValue.call(input, 'dee')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(rows()).toEqual(['2Cal vs DeeAwaiting'])
  })

  test('no released round yet says pairings are coming', () => {
    state.matches = () => ({ phases: [], round: null, matches: [] })
    render('in_progress')
    expect(text()).toContain('No pairings yet')
  })

  test('a cancelled event marks its unfinished matches as not played', () => {
    state.matches = () => matchesFor(2)
    render('cancelled')
    // A cancelled event opens on standings; the matches tab is one click.
    act(() => {
      const tab = Array.from(container.querySelectorAll('[role="tab"]')).find(
        (candidate) => candidate.textContent === 'Matches',
      )!
      tab.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(text()).toContain('Not finished')
    expect(rows()).toContain('2Cal vs DeeNot played')
  })

  test('a refused viewer sees nothing here', () => {
    state.matches = () => null
    render('in_progress')
    expect(rows()).toEqual([])
    expect(text()).not.toContain('No pairings yet')
  })
})

describe('standings', () => {
  test('a completed event opens on its final standings', () => {
    state.standings = standings
    render('completed')
    expect(text()).toContain('Final standings')
    expect(text()).toContain('After Round 1')
    const standingRows = Array.from(
      container.querySelectorAll('button[aria-expanded]'),
    ).map((row) => clean(row.textContent))
    expect(standingRows).toEqual(['1Ada1–0–03', '2BrookDropped0–1–00'])
  })

  test('before a round completes there are no standings yet', () => {
    state.standings = { standings: null }
    render('completed')
    expect(text()).toContain('No standings yet')
  })
})
