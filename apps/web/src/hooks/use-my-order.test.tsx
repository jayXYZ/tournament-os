// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import {
  useMyBadge,
  useMyBadgeRefundFlag,
  useMyRefundFlag,
} from '@tournament-os/core'
import { useMyBadgeOrder, useMyEntryOrder } from './use-my-order'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn((_query, args) => (args === 'skip' ? undefined : null)),
  useMutation: vi.fn(),
  useConvexAuth: vi.fn(),
}))
vi.mock('convex/react', () => mocks)
afterEach(cleanup)

const tournamentId = 'tournament' as Id<'tournaments'>
const conventionId = 'convention' as Id<'conventions'>

test.each([
  ['badge', () => useMyBadge(conventionId)],
  ['badge refund warning', () => useMyBadgeRefundFlag(conventionId)],
  ['entry refund warning', () => useMyRefundFlag(tournamentId)],
  ['badge order', () => useMyBadgeOrder(conventionId)],
  ['entry order', () => useMyEntryOrder(tournamentId)],
] as const)(
  '%s waits for token validation and skips again on sign-out',
  (_name, hook) => {
    mocks.useConvexAuth.mockReturnValue({
      isLoading: true,
      isAuthenticated: false,
    })
    const { result, rerender } = renderHook(() => hook())
    expect(result.current).toBeUndefined()
    expect(mocks.useQuery.mock.calls.at(-1)?.[1]).toBe('skip')

    mocks.useConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: true,
    })
    rerender()
    expect(result.current).toBeNull()
    expect(mocks.useQuery.mock.calls.at(-1)?.[1]).not.toBe('skip')

    mocks.useConvexAuth.mockReturnValue({
      isLoading: false,
      isAuthenticated: false,
    })
    rerender()
    expect(result.current).toBeUndefined()
    expect(mocks.useQuery.mock.calls.at(-1)?.[1]).toBe('skip')
  },
)
