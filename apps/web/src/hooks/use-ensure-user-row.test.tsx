// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexError } from 'convex/values'
import { getFunctionName } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Root } from 'react-dom/client'

// useConvexAuth drives the readiness the sign-in waits on; useQuery answers
// the Claim signal (users:hasUnclaimedGuest) the sign-in subscribes to;
// useMutation hands back the recorded upsertMe.
const mocks = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}))
vi.mock('convex/react', () => mocks)

const { ACCOUNT_SETUP_FAILED_MESSAGE } = await import('@paper-pairings/core')
const { EnsureUserRowProvider, useEnsureUserRow } =
  await import('./use-ensure-user-row')

const authStates = {
  pending: { isLoading: true, isAuthenticated: false },
  signedOut: { isLoading: false, isAuthenticated: false },
  ready: { isLoading: false, isAuthenticated: true },
} as const

// The Claim signal's answer: `undefined` while it has not answered yet (or
// is skipped), else whether a Guest carries the viewer's email.
type Signal = boolean | undefined

let latest: ReturnType<typeof useEnsureUserRow> | undefined
function Probe() {
  latest = useEnsureUserRow()
  return null
}

const upsertMe = vi.fn<() => Promise<unknown>>()
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.useConvexAuth.mockReset()
  mocks.useQuery.mockReset().mockReturnValue(undefined)
  mocks.useMutation.mockReset().mockReturnValue(upsertMe)
  upsertMe.mockReset().mockResolvedValue('user')
  latest = undefined
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
})

// Runs `step` inside act and lets the sign-in's promise settle before
// returning, so a rejection's state update lands inside act as well.
async function settle(step: () => void) {
  await act(async () => {
    step()
    await Promise.resolve()
  })
}

async function renderWith(state: keyof typeof authStates, signal: Signal) {
  mocks.useConvexAuth.mockReturnValue(authStates[state])
  mocks.useQuery.mockReturnValue(signal)
  await settle(() => {
    root.render(
      <EnsureUserRowProvider>
        <Probe />
      </EnsureUserRowProvider>,
    )
  })
}

// What the last render subscribed the Claim signal with: `{}` once the
// viewer is verified, 'skip' before.
function lastSignalArgs() {
  return mocks.useQuery.mock.calls.at(-1)?.[1]
}

test('the provider binds the backend sign-in and the Claim signal', async () => {
  await renderWith('pending', undefined)
  expect(getFunctionName(mocks.useMutation.mock.calls[0][0])).toBe(
    'users:upsertMe',
  )
  expect(getFunctionName(mocks.useQuery.mock.calls[0][0])).toBe(
    'users:hasUnclaimedGuest',
  )
})

test.each([['pending'], ['signedOut']] as const)(
  'runs nothing while %s — a mutation sent before Convex verifies the viewer is refused, and the signal is not read',
  async (state) => {
    // Even a signal answering true (it cannot, being skipped) runs nothing.
    await renderWith(state, true)
    expect(lastSignalArgs()).toBe('skip')
    expect(upsertMe).not.toHaveBeenCalled()
    expect(latest?.failure).toBeNull()
  },
)

test('runs the sign-in once Convex has verified the viewer and the Claim signal has answered, once per sign-in', async () => {
  await renderWith('pending', undefined)
  // Verified, but the signal has not answered: the sign-in waits for it, so
  // it sees every enrollment the answer saw.
  await renderWith('ready', undefined)
  expect(lastSignalArgs()).toEqual({})
  expect(upsertMe).not.toHaveBeenCalled()
  await renderWith('ready', false)
  expect(upsertMe).toHaveBeenCalledTimes(1)
  // A re-render with the same readiness and answer is not another sign-in.
  await renderWith('ready', false)
  expect(upsertMe).toHaveBeenCalledTimes(1)
  // Signing out and back in is.
  await renderWith('signedOut', undefined)
  await renderWith('ready', false)
  expect(upsertMe).toHaveBeenCalledTimes(2)
  expect(latest?.failure).toBeNull()
})

test('an enrollment landing while the app is open runs the sign-in again; a Guest the Claim leaves whole does not', async () => {
  await renderWith('ready', false)
  expect(upsertMe).toHaveBeenCalledTimes(1)
  // The organizer enrolls the viewer's email: the signal turns true, and the
  // sign-in runs the Claim without a page load.
  await renderWith('ready', true)
  expect(upsertMe).toHaveBeenCalledTimes(2)
  // Still true afterwards — a collision elsewhere kept the Guest from the
  // Claim, or the scheduled walk is merging it — runs nothing more.
  await renderWith('ready', true)
  expect(upsertMe).toHaveBeenCalledTimes(2)
  // Merged (or walked) and gone, then a later enrollment: once more.
  await renderWith('ready', false)
  expect(upsertMe).toHaveBeenCalledTimes(2)
  await renderWith('ready', true)
  expect(upsertMe).toHaveBeenCalledTimes(3)
  expect(latest?.failure).toBeNull()
})

test('a Guest already waiting when the app opens is one sign-in, not two', async () => {
  await renderWith('ready', true)
  expect(upsertMe).toHaveBeenCalledTimes(1)
  await renderWith('ready', true)
  expect(upsertMe).toHaveBeenCalledTimes(1)
  // Opening the app signed out and signing in with the Guest still waiting
  // is that session's one sign-in.
  await renderWith('signedOut', undefined)
  await renderWith('ready', true)
  expect(upsertMe).toHaveBeenCalledTimes(2)
})

test("surfaces the backend's own refusal, falls back for anything else, and retries on demand", async () => {
  upsertMe.mockRejectedValueOnce(new ConvexError('Your account has no name.'))
  await renderWith('ready', false)
  expect(latest?.failure).toBe('Your account has no name.')

  upsertMe.mockRejectedValueOnce(
    new Error('[CONVEX M(users:upsertMe)] Server Error'),
  )
  await settle(() => latest?.retry())
  expect(upsertMe).toHaveBeenCalledTimes(2)
  expect(latest?.failure).toBe(ACCOUNT_SETUP_FAILED_MESSAGE)

  await settle(() => latest?.retry())
  expect(latest?.failure).toBeNull()
})

test('a failure does not outlive the session it came from', async () => {
  upsertMe.mockRejectedValueOnce(new ConvexError('Your account has no name.'))
  await renderWith('ready', false)
  expect(latest?.failure).not.toBeNull()
  await renderWith('signedOut', undefined)
  expect(latest?.failure).toBeNull()
})

test('the hook refuses to run outside the provider', () => {
  mocks.useConvexAuth.mockReturnValue(authStates.ready)
  expect(() => {
    act(() => {
      root.render(<Probe />)
    })
  }).toThrow('EnsureUserRowProvider')
})
