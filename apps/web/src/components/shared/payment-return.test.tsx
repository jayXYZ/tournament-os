// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { TOKEN_VALIDATION_GRACE_MS } from '@paper-pairings/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { Root } from 'react-dom/client'

const mocks = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useQuery: vi.fn(),
  useMutation: vi.fn(),
  useAppAuth: vi.fn(),
  refreshAuth: vi.fn(),
}))
vi.mock('convex/react', () => ({
  useConvexAuth: mocks.useConvexAuth,
  useQuery: mocks.useQuery,
  useMutation: mocks.useMutation,
}))
vi.mock('@/lib/use-app-auth', () => ({ useAppAuth: mocks.useAppAuth }))

const { PaymentReturnAuthGate } = await import('./payment-return')

const user = { email: 'player@example.com' }
const convexStates = {
  pending: { isLoading: true, isAuthenticated: false },
  unauthenticated: { isLoading: false, isAuthenticated: false },
  ready: { isLoading: false, isAuthenticated: true },
} as const

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.refreshAuth.mockReset()
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

function render(
  appAuth: { user: typeof user | null; loading: boolean },
  convex: keyof typeof convexStates,
) {
  mocks.useAppAuth.mockReturnValue({
    ...appAuth,
    refreshAuth: mocks.refreshAuth,
  })
  mocks.useConvexAuth.mockReturnValue(convexStates[convex])
  act(() => {
    root.render(
      <PaymentReturnAuthGate>
        <p>order outcome</p>
      </PaymentReturnAuthGate>,
    )
  })
  return container.textContent
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
  return container.textContent
}

function clickSignIn() {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Sign in',
  )
  act(() => {
    button?.click()
  })
}

test.each([
  ['Clerk is loading', { user: null, loading: true }, 'pending'],
  ['Convex is validating the token', { user, loading: false }, 'pending'],
] as const)('waits while %s', (_name, appAuth, convex) => {
  const text = render(appAuth, convex)
  expect(text).toContain('Checking your account')
  expect(text).not.toContain('order outcome')
})

test('offers sign-in to a signed-out visitor', () => {
  const text = render({ user: null, loading: false }, 'unauthenticated')
  expect(text).toContain('Sign in to view your payment')
  expect(text).not.toContain('order outcome')

  clickSignIn()
  expect(mocks.refreshAuth).toHaveBeenCalledWith({ ensureSignedIn: true })
})

// convex-react reports a session activated in place (no page load) as
// unauthenticated until it validates the new token; that must read as
// checking, not as a request to sign in again.
test('keeps checking while Convex validates an in-place sign-in', () => {
  expect(render({ user, loading: false }, 'unauthenticated')).toContain(
    'Checking your account',
  )
  expect(render({ user, loading: false }, 'ready')).toBe('order outcome')
})

// Clerk has a user but Convex refused the token: the outcome's authed
// queries would stay skipped forever, so after the grace offer sign-in.
test('offers sign-in once Convex has refused a Clerk user', () => {
  expect(render({ user, loading: false }, 'unauthenticated')).toContain(
    'Checking your account',
  )
  expect(advance(TOKEN_VALIDATION_GRACE_MS - 1)).toContain(
    'Checking your account',
  )
  const text = advance(1)
  expect(text).toContain('Sign in to view your payment')
  expect(text).not.toContain('order outcome')

  clickSignIn()
  expect(mocks.refreshAuth).toHaveBeenCalledWith({ ensureSignedIn: true })
})

test('mounts the outcome once Convex has validated the viewer', () => {
  expect(render({ user, loading: false }, 'ready')).toBe('order outcome')
})
