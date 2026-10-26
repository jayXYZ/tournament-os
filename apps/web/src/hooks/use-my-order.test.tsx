// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { getFunctionName } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'

// useConvexAuth drives the readiness the hooks wait on; useQuery records the
// args it was handed and answers any non-skipped subscription with `order`.
const mocks = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}))
vi.mock('convex/react', () => mocks)

const { useMyBadgeOrder, useMyEntryOrder } = await import('./use-my-order')

const tournamentId = 'tournament' as Id<'tournaments'>
const conventionId = 'convention' as Id<'conventions'>
const order = { status: 'paid' }

// 12:00:30 rounds up to 12:01:00 (see useClientClock's `round`).
const clockAt = new Date('2026-10-25T12:00:30Z').getTime()
const roundedUp = new Date('2026-10-25T12:01:00Z').getTime()

const authStates = {
  pending: { isLoading: true, isAuthenticated: false },
  ready: { isLoading: false, isAuthenticated: true },
  signedOut: { isLoading: false, isAuthenticated: false },
} as const

let latest: unknown
function Probe({ hook }: { hook: () => unknown }) {
  latest = hook()
  return null
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(clockAt)
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.useQuery
    .mockReset()
    .mockImplementation((_query, args) => (args === 'skip' ? undefined : order))
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function render(auth: keyof typeof authStates, hook: () => unknown) {
  mocks.useConvexAuth.mockReturnValue(authStates[auth])
  act(() => {
    root.render(<Probe hook={hook} />)
  })
}

function lastQueryCall() {
  const call = mocks.useQuery.mock.calls.at(-1)
  if (!call) throw new Error('useQuery was not called')
  return { name: getFunctionName(call[0]), args: call[1] }
}

test.each([
  [
    'useMyEntryOrder',
    () => useMyEntryOrder(tournamentId),
    'payments/queries:getMyEntryOrder',
    { tournamentId, now: roundedUp },
  ],
  [
    'useMyBadgeOrder',
    () => useMyBadgeOrder(conventionId),
    'payments/queries:getMyBadgeOrder',
    { conventionId, now: roundedUp },
  ],
] as const)(
  '%s waits for token validation and drops the order on sign-out',
  (_name, hook, name, args) => {
    // The token-lag window reads as loading, never as "no order".
    render('pending', hook)
    expect(latest).toBeUndefined()
    expect(lastQueryCall()).toEqual({ name, args: 'skip' })

    render('ready', hook)
    expect(latest).toBe(order)
    expect(lastQueryCall()).toEqual({ name, args })

    // useStableQuery must not hold the previous viewer's order.
    render('signedOut', hook)
    expect(latest).toBeUndefined()
    expect(lastQueryCall()).toEqual({ name, args: 'skip' })
  },
)

test.each([
  ['useMyEntryOrder', () => useMyEntryOrder(null)],
  ['useMyBadgeOrder', () => useMyBadgeOrder(null)],
] as const)('%s skips without an id even when ready', (_name, hook) => {
  render('ready', hook)
  expect(latest).toBeUndefined()
  expect(lastQueryCall().args).toBe('skip')
})
