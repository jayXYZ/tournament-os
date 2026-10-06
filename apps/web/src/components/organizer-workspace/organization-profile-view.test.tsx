// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { OrganizationProfileView } from './organization-profile-view'

const workspace = vi.hoisted(() => ({ organizationId: 'organization-a' }))

vi.mock('./organization-context', () => ({
  useOrganization: () => ({
    selectedOrganizationId: workspace.organizationId,
    selectedOrganization: {
      organization: {
        _id: workspace.organizationId,
        name: workspace.organizationId,
        profileImageUrl: null,
      },
      membership: { role: 'owner' },
    },
    clearSelectedOrganization: vi.fn(),
  }),
}))

vi.mock('convex/react', () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
  useQuery: () => ({
    canManage: true,
    stripeConfigured: true,
    connection: null,
  }),
}))

test('switching organizations requires a fresh US acknowledgement', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  workspace.organizationId = 'organization-a'
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  function checkbox() {
    const element =
      container.querySelector<HTMLButtonElement>('[role="checkbox"]')
    if (!element) throw new Error('US acknowledgement checkbox not found')
    return element
  }

  function connectButton() {
    const element = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Connect Stripe',
    )
    if (!element) throw new Error('Connect Stripe button not found')
    return element
  }

  try {
    await act(() => root.render(<OrganizationProfileView />))
    expect(checkbox().getAttribute('aria-checked')).toBe('false')
    expect(connectButton().disabled).toBe(true)

    await act(() => checkbox().click())
    expect(connectButton().disabled).toBe(false)

    // A normal rerender in the same organization preserves the confirmation.
    await act(() => root.render(<OrganizationProfileView />))
    expect(checkbox().getAttribute('aria-checked')).toBe('true')
    expect(connectButton().disabled).toBe(false)

    workspace.organizationId = 'organization-b'
    await act(() => root.render(<OrganizationProfileView />))
    expect(checkbox().getAttribute('aria-checked')).toBe('false')
    expect(connectButton().disabled).toBe(true)

    await act(() => checkbox().click())
    expect(connectButton().disabled).toBe(false)

    workspace.organizationId = 'organization-a'
    await act(() => root.render(<OrganizationProfileView />))
    expect(checkbox().getAttribute('aria-checked')).toBe('false')
    expect(connectButton().disabled).toBe(true)
  } finally {
    await act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
