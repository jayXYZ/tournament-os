// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexError } from 'convex/values'
import { getFunctionName } from 'convex/server'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Root } from 'react-dom/client'

// useConvexAuth drives the readiness the sign-in waits on; useMutation hands
// back the recorded upsertMe.
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

async function renderWith(state: keyof typeof authStates) {
  mocks.useConvexAuth.mockReturnValue(authStates[state])
  await settle(() => {
    root.render(
      <EnsureUserRowProvider>
        <Probe />
      </EnsureUserRowProvider>,
    )
  })
}

test('the provider binds the backend sign-in', async () => {
  await renderWith('pending')
  expect(getFunctionName(mocks.useMutation.mock.calls[0][0])).toBe(
    'users:upsertMe',
  )
})

test.each([['pending'], ['signedOut']] as const)(
  'runs nothing while %s — a mutation sent before Convex verifies the viewer is refused',
  async (state) => {
    await renderWith(state)
    expect(upsertMe).not.toHaveBeenCalled()
    expect(latest?.failure).toBeNull()
  },
)

test('runs the sign-in once Convex has verified the viewer, once per sign-in', async () => {
  await renderWith('pending')
  await renderWith('ready')
  expect(upsertMe).toHaveBeenCalledTimes(1)
  // A re-render with the same readiness is not another sign-in.
  await renderWith('ready')
  expect(upsertMe).toHaveBeenCalledTimes(1)
  // Signing out and back in is.
  await renderWith('signedOut')
  await renderWith('ready')
  expect(upsertMe).toHaveBeenCalledTimes(2)
  expect(latest?.failure).toBeNull()
})

test("surfaces the backend's own refusal, falls back for anything else, and retries on demand", async () => {
  upsertMe.mockRejectedValueOnce(new ConvexError('Your account has no name.'))
  await renderWith('ready')
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
  await renderWith('ready')
  expect(latest?.failure).not.toBeNull()
  await renderWith('signedOut')
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
