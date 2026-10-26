// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ConvexClerkAuthProvider,
  TOKEN_VALIDATION_GRACE_MS,
} from '@paper-pairings/core'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ComponentProps } from 'react'
import type { Root } from 'react-dom/client'

// Only Clerk is stood in for. The Convex side is real — ConvexClerkAuthProvider
// over convex-react's ConvexProviderWithAuth — down to a fake client that
// records what the provider asks of it: each `setAuth` captures the callback
// the server's verdict would arrive on, which the test then answers, and
// `clearAuth` counts teardowns. So what is exercised is the actual recovery
// path, not a stub of it.
const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useUser: vi.fn(),
  redirectToSignIn: vi.fn(),
  signOut: vi.fn(),
}))
vi.mock('@clerk/tanstack-react-start', () => ({
  useAuth: mocks.useAuth,
  useUser: mocks.useUser,
  useClerk: () => ({
    redirectToSignIn: mocks.redirectToSignIn,
    signOut: mocks.signOut,
  }),
}))

const { PaymentReturnAuthGate } = await import('./payment-return')

const clerkUser = {
  primaryEmailAddress: { emailAddress: 'player@example.com' },
  firstName: 'Ada',
  lastName: null,
}
const getToken = vi.fn().mockResolvedValue('jwt')

function clerk(state: 'loading' | 'signedOut' | 'signedIn') {
  const isLoaded = state !== 'loading'
  mocks.useAuth.mockReturnValue({
    isLoaded,
    isSignedIn: isLoaded ? state === 'signedIn' : undefined,
    getToken,
    orgId: undefined,
    orgRole: undefined,
    sessionClaims: undefined,
  })
  mocks.useUser.mockReturnValue({
    isLoaded,
    user: state === 'signedIn' ? clerkUser : isLoaded ? null : undefined,
  })
}

type Client = ComponentProps<typeof ConvexClerkAuthProvider>['client']
let verdicts: Array<(isAuthenticated: boolean) => void>
const client: Client = {
  setAuth: vi.fn((_fetchToken, onChange) => {
    verdicts.push(onChange)
  }),
  clearAuth: vi.fn(),
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  verdicts = []
  vi.mocked(client.setAuth).mockClear()
  vi.mocked(client.clearAuth).mockClear()
  mocks.redirectToSignIn.mockReset()
  mocks.signOut.mockReset()
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

// Mounts, or re-renders against the current Clerk mocks.
function render() {
  act(() => {
    root.render(
      <ConvexClerkAuthProvider client={client} useAuth={mocks.useAuth}>
        <PaymentReturnAuthGate>
          <p>order outcome</p>
        </PaymentReturnAuthGate>
      </ConvexClerkAuthProvider>,
    )
  })
  return text()
}

function text() {
  return container.textContent
}

// The server's verdict on the most recent handshake.
function verdict(isAuthenticated: boolean) {
  const latest = verdicts.at(-1)
  if (!latest) throw new Error('no handshake in flight')
  act(() => {
    latest(isAuthenticated)
  })
  return text()
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
  return text()
}

function click(label: string) {
  const button = [...container.querySelectorAll('button')].find(
    (b) => b.textContent === label,
  )
  if (!button) throw new Error(`no "${label}" button`)
  act(() => {
    button.click()
  })
  return text()
}

const CHECKING = 'Checking your account'
const SIGN_IN = 'Sign in to view your payment'
const UNVERIFIED = "We couldn't verify your account"

// Runs the handshake to its first refusal and out the grace: what a refused
// token or a failed token fetch looks like from the page.
function reachUnverified() {
  clerk('signedIn')
  expect(render()).toContain(CHECKING)
  expect(client.setAuth).toHaveBeenCalledTimes(1)
  expect(verdict(false)).toContain(CHECKING)
  expect(advance(TOKEN_VALIDATION_GRACE_MS - 1)).toContain(CHECKING)
  return advance(1)
}

test('waits while Clerk is loading', () => {
  clerk('loading')
  const shown = render()
  expect(shown).toContain(CHECKING)
  expect(shown).not.toContain('order outcome')
  expect(client.setAuth).not.toHaveBeenCalled()
})

test('offers sign-in to a signed-out visitor, and sign-in goes to Clerk', () => {
  clerk('signedOut')
  const shown = render()
  expect(shown).toContain(SIGN_IN)
  expect(shown).not.toContain('order outcome')
  expect(client.setAuth).not.toHaveBeenCalled()

  click('Sign in')
  expect(mocks.redirectToSignIn).toHaveBeenCalledWith({
    signInForceRedirectUrl: window.location.href,
    signUpForceRedirectUrl: window.location.href,
  })
})

// convex-react keeps its signed-out verdict (not loading) while it validates
// a session activated in place; that must read as checking, never as a
// request to sign in again, and the outcome mounts as soon as the server
// confirms the token.
test('keeps checking through an in-place sign-in until the server confirms it', () => {
  clerk('signedOut')
  expect(render()).toContain(SIGN_IN)

  clerk('signedIn')
  expect(render()).toContain(CHECKING)
  expect(client.setAuth).toHaveBeenCalledTimes(1)
  expect(advance(TOKEN_VALIDATION_GRACE_MS - 1)).toContain(CHECKING)
  expect(verdict(true)).toBe('order outcome')
})

test('mounts the outcome once Convex has validated the viewer', () => {
  clerk('signedIn')
  render()
  expect(verdict(true)).toBe('order outcome')
})

// Clerk has a user but the handshake ended without a verified identity: the
// outcome's authed queries would stay skipped forever, so after the grace
// the page offers recovery — and not sign-in, which cannot restart a
// handshake while the Clerk session is live.
test('offers recovery, not sign-in, once a Clerk user stays unverified past the grace', () => {
  const shown = reachUnverified()
  expect(shown).toContain(UNVERIFIED)
  expect(shown).toContain('Try again')
  expect(shown).toContain('Sign out')
  expect(shown).not.toContain(SIGN_IN)
  expect(shown).not.toContain('order outcome')
  expect(mocks.redirectToSignIn).not.toHaveBeenCalled()
})

test('"Try again" tears the old auth down and runs a fresh handshake', () => {
  reachUnverified()

  const shown = click('Try again')
  expect(client.clearAuth).toHaveBeenCalledTimes(1)
  expect(client.setAuth).toHaveBeenCalledTimes(2)
  // Back to checking, with no flash of the recovery card or the outcome.
  expect(shown).toContain(CHECKING)
  expect(shown).not.toContain(UNVERIFIED)

  expect(verdict(true)).toBe('order outcome')
})

test('a verdict on the torn-down handshake is ignored after "Try again"', () => {
  reachUnverified()
  click('Try again')

  const stale = verdicts[0]
  act(() => {
    stale(true)
  })
  expect(text()).toContain(CHECKING)
  expect(text()).not.toContain('order outcome')
})

test('a retried handshake that stays unverified gets a full grace of its own', () => {
  reachUnverified()
  click('Try again')

  expect(verdict(false)).toContain(CHECKING)
  expect(advance(TOKEN_VALIDATION_GRACE_MS - 1)).toContain(CHECKING)
  expect(advance(1)).toContain(UNVERIFIED)
})

test('"Sign out" ends the Clerk session, after which sign-in is offered', () => {
  reachUnverified()

  click('Sign out')
  // Told to stay here: Clerk would otherwise navigate to its after-sign-out
  // URL (the home page) and the viewer would lose the page they came back to.
  expect(mocks.signOut).toHaveBeenCalledWith({
    redirectUrl: window.location.href,
  })

  // Clerk reports the session gone; the provider clears Convex auth and the
  // page falls back to its ordinary sign-in card.
  clerk('signedOut')
  const shown = render()
  expect(client.clearAuth).toHaveBeenCalledTimes(1)
  expect(shown).toContain(SIGN_IN)
  expect(shown).not.toContain(UNVERIFIED)
})

test('a late confirmation inside the grace mounts the outcome', () => {
  clerk('signedIn')
  render()
  expect(verdict(false)).toContain(CHECKING)
  expect(advance(TOKEN_VALIDATION_GRACE_MS - 1)).toContain(CHECKING)
  expect(verdict(true)).toBe('order outcome')
})
