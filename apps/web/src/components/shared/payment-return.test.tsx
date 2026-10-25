// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
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

test.each([
  ['Clerk is loading', { user: null, loading: true }, 'pending'],
  ['Convex is validating the token', { user, loading: false }, 'pending'],
] as const)('waits while %s', (_name, appAuth, convex) => {
  const text = render(appAuth, convex)
  expect(text).toContain('Checking your account')
  expect(text).not.toContain('order outcome')
})

test.each([
  ['a signed-out visitor', { user: null, loading: false }],
  // Clerk has a user but Convex rejected the token: the outcome's authed
  // queries would stay skipped forever, so offer sign-in instead.
  ['a Clerk user whose token Convex rejected', { user, loading: false }],
] as const)('offers sign-in to %s', (_name, appAuth) => {
  const text = render(appAuth, 'unauthenticated')
  expect(text).toContain('Sign in to view your payment')
  expect(text).not.toContain('order outcome')

  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === 'Sign in',
  )
  act(() => {
    button?.click()
  })
  expect(mocks.refreshAuth).toHaveBeenCalledWith({ ensureSignedIn: true })
})

test('mounts the outcome once Convex has validated the viewer', () => {
  expect(render({ user, loading: false }, 'ready')).toBe('order outcome')
})
