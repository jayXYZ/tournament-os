// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { roundedClock, useClientClock } from './use-client-clock'
import type { ClientClockOptions } from './use-client-clock'
import type { Root } from 'react-dom/client'

const MINUTE = 60_000
// A wall-clock instant 20s past a minute boundary.
const BOUNDARY = Math.floor(1_700_000_000_000 / MINUTE) * MINUTE
const T0 = BOUNDARY + 20_000

let renders = 0
let latest: number
function Probe(options: ClientClockOptions) {
  renders += 1
  latest = useClientClock(options)
  return null
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  renders = 0
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function mount(options: ClientClockOptions = {}) {
  act(() => {
    root.render(<Probe {...options} />)
  })
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

test('roundedClock rounds to the requested side of the bucket', () => {
  expect(roundedClock(T0, MINUTE, 'down')).toBe(BOUNDARY)
  expect(roundedClock(T0, MINUTE, 'up')).toBe(BOUNDARY + MINUTE)
  expect(roundedClock(BOUNDARY, MINUTE, 'up')).toBe(BOUNDARY)
})

test('ticks on the minute boundary, not a minute after mount', () => {
  mount()
  expect(latest).toBe(BOUNDARY)
  const rendersAfterMount = renders

  // 39s later we are 1s short of the boundary: no change, no re-render.
  advance(39_000)
  expect(latest).toBe(BOUNDARY)
  expect(renders).toBe(rendersAfterMount)

  // Crossing the boundary flips the value once.
  advance(2_000)
  expect(latest).toBe(BOUNDARY + MINUTE)
  expect(renders).toBe(rendersAfterMount + 1)

  // And the next tick is again aligned to the boundary.
  advance(MINUTE)
  expect(latest).toBe(BOUNDARY + 2 * MINUTE)
})

test('rounding up reports the far side of the bucket and advances at the boundary', () => {
  mount({ round: 'up' })
  expect(latest).toBe(BOUNDARY + MINUTE)
  advance(40_000)
  expect(latest).toBe(BOUNDARY + MINUTE)
  advance(1_000)
  expect(latest).toBe(BOUNDARY + 2 * MINUTE)
})

test('refreshes when the tab becomes visible again after a throttled timer', () => {
  mount()
  expect(latest).toBe(BOUNDARY)
  // Jump the system clock without running timers, as a backgrounded tab's
  // throttled timer would leave it.
  vi.setSystemTime(T0 + 5 * MINUTE)
  expect(latest).toBe(BOUNDARY)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(latest).toBe(BOUNDARY + 5 * MINUTE)
})
