// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Root } from 'react-dom/client'
import type * as Core from '@paper-pairings/core'
import type * as Router from '@tanstack/react-router'

// The /join/<code> route's shells for a code that opened nothing. The
// resolution hook is stubbed at its seam; the route's own params come from a
// stand-in createFileRoute.

type State = {
  resolution: Core.JoinCodeResolution
  viewer: 'ready' | 'signedOut'
}

const state = vi.hoisted(() => {
  const answers: State = { resolution: { state: 'loading' }, viewer: 'ready' }
  return { answers, refreshAuth: vi.fn() }
})

vi.mock('@paper-pairings/core', async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  useJoinCode: () => state.answers.resolution,
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
  Navigate: () => null,
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
