// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api } from '@tournament-os/backend/convex/_generated/api'
import { useTimedQuery } from './use-timed-query'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'

const { useQuery } = vi.hoisted(() => ({ useQuery: vi.fn() }))
vi.mock('convex/react', () => ({ useQuery }))

const conventionId = 'convention' as Id<'conventions'>
const query = api.conventions.ticketTypes.listPublicTicketTypes

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
  useQuery.mockReset().mockImplementation((_query, args) =>
    args === 'skip'
      ? undefined
      : [
          {
            onSale: args.now >= 2000 && args.now <= 3000,
            refreshAt: args.now < 2000 ? 2000 : args.now <= 3000 ? 3001 : null,
          },
        ],
  )
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

test('refreshes at sale opening and inclusive closing without database updates', () => {
  const { result, unmount } = renderHook(() =>
    useTimedQuery(query, { conventionId }),
  )
  expect(result.current?.[0].onSale).toBe(false)
  act(() => vi.advanceTimersByTime(1000))
  expect(result.current?.[0].onSale).toBe(true)
  act(() => vi.advanceTimersByTime(1000))
  expect(result.current?.[0].onSale).toBe(true)
  act(() => vi.advanceTimersByTime(1))
  expect(result.current?.[0].onSale).toBe(false)
  unmount()
  expect(vi.getTimerCount()).toBe(0)
})

test('refreshes after a suspended tab regains focus', () => {
  const { result } = renderHook(() => useTimedQuery(query, { conventionId }))
  act(() => {
    vi.setSystemTime(4000)
    window.dispatchEvent(new Event('focus'))
  })
  expect(result.current?.[0]).toMatchObject({ onSale: false, refreshAt: null })
  expect(useQuery.mock.calls.at(-1)?.[1].now).toBe(4000)
})

test('skipped queries do not schedule timers or send clock arguments', () => {
  const { result } = renderHook(() => useTimedQuery(query, 'skip'))
  expect(result.current).toBeUndefined()
  expect(useQuery).toHaveBeenLastCalledWith(query, 'skip')
  expect(vi.getTimerCount()).toBe(0)
})

test('distant deadlines do not overflow the browser timeout', () => {
  useQuery.mockReturnValue([{ refreshAt: 4_000_000_000 }])
  renderHook(() => useTimedQuery(query, { conventionId }))
  const calls = useQuery.mock.calls.length
  act(() => vi.advanceTimersByTime(1000))
  expect(useQuery).toHaveBeenCalledTimes(calls)
  act(() => vi.advanceTimersByTime(2_147_483_647))
  expect(useQuery.mock.calls.length).toBeGreaterThan(calls)
})
