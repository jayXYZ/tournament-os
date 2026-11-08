// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import type * as Core from '@paper-pairings/core'
import type * as Router from '@tanstack/react-router'

// The /join/<code> route: the redirect a resolved code makes, and the shells
// for one still resolving or that opened nothing. The resolution hook is
// stubbed at its seam; the route's own params come from a stand-in
// createFileRoute.

type State = {
  resolution: Core.JoinCodeResolution
  viewer: 'ready' | 'signedOut'
}

const state = vi.hoisted(() => {
  const answers: State = { resolution: { state: 'loading' }, viewer: 'ready' }
  return { answers, refreshAuth: vi.fn(), navigate: vi.fn() }
})

vi.mock('@paper-pairings/core', async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  useJoinCode: () => state.answers.resolution,
  // The unverified shell's "Try again" restarts the Convex handshake, which
  // needs the auth provider; the stub stands in for it here.
  useRestartConvexAuth: () => vi.fn(),
}))

vi.mock('@/lib/use-app-auth', () => ({
  useAppAuth: () => ({
    user:
      state.answers.viewer === 'signedOut' ? null : { email: 'p@example.com' },
    loading: false,
    refreshAuth: state.refreshAuth,
    signOut: vi.fn(),
  }),
}))

vi.mock('@/components/shared/site-shell', () => ({
  SiteShell: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  createFileRoute: () => (options: { component: () => React.ReactNode }) => ({
    options,
    useParams: () => ({ code: '7K3M9Q' }),
  }),
  Link: ({ to, children }: { to: string; children?: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
  // Records the redirect it would make, so the resolved cases can check
  // where the route sends the viewer and what it carries along.
  Navigate: (props: Record<string, unknown>) => {
    state.navigate(props)
    return null
  },
}))

const { Route } = await import('@/routes/join.$code')
const JoinRoute = (Route as unknown as { options: { component: () => null } })
  .options.component

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function render(resolution: Core.JoinCodeResolution) {
  state.answers.resolution = resolution
  act(() => root.render(<JoinRoute />))
}

const text = () => container.textContent.replace(/\s+/g, ' ').trim()

describe('/join/$code', () => {
  test('a resolved public code redirects to the event page', () => {
    render({ state: 'resolved', publicCode: '7K3M9Q', inviteCode: undefined })
    expect(state.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/tournaments/$tournamentId',
        params: { tournamentId: '7K3M9Q' },
        search: { invite: undefined },
        replace: true,
      }),
    )
    expect(text()).toBe('')
  })

  test('a resolved invite code carries the invite to the event page', () => {
    render({
      state: 'resolved',
      publicCode: '7K3M9Q',
      inviteCode: 'ABCDEFGHJK',
    })
    expect(state.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { tournamentId: '7K3M9Q' },
        search: { invite: 'ABCDEFGHJK' },
      }),
    )
  })

  test('a code still resolving shows the loading shell', () => {
    render({ state: 'loading' })
    expect(text()).toContain('Opening event')
    expect(state.navigate).not.toHaveBeenCalled()
  })

  test('a viewer Convex could not verify is offered the recovery, not "Code not found"', () => {
    render({ state: 'unverified' })
    expect(text()).toContain("We couldn't verify your account")
    expect(text()).not.toContain('Code not found')
  })

  test('a code that opened nothing for a signed-out viewer offers sign-in', async () => {
    state.answers.viewer = 'signedOut'
    render({ state: 'signInToView' })
    expect(text()).toContain('Sign in to view this event')
    expect(text()).not.toContain('Code not found')
    const signIn = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent.trim() === 'Sign in',
    )
    await act(async () => {
      signIn!.click()
      await Promise.resolve()
    })
    expect(state.refreshAuth).toHaveBeenCalledWith({ ensureSignedIn: true })
  })

  test('a code that opened nothing for a signed-in viewer is not found', () => {
    state.answers.viewer = 'ready'
    render({ state: 'notFound' })
    expect(text()).toContain('Code not found')
    expect(text()).not.toContain('Sign in')
  })
})
