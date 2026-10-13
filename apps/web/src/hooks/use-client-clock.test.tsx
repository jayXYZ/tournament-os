// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { useClientClock } from './use-client-clock'
import type { Root } from 'react-dom/client'

// The rounding and boundary scheduling are pinned in @paper-pairings/core
// (client-clock.test.ts); this covers only the browser wake source.

const MINUTE = 60_000
// A wall-clock instant 20s past a minute boundary.
const BOUNDARY = Math.floor(1_700_000_000_000 / MINUTE) * MINUTE
const T0 = BOUNDARY + 20_000

let latest: number
function Probe() {
  latest = useClientClock()
  return null
}

let root: Root
let container: HTMLDivElement
let visibility: DocumentVisibilityState

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  visibility = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(
    () => visibility,
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() => {
    root.render(<Probe />)
  })
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// Jump the system clock without running timers, as a backgrounded tab's
// throttled timer would leave it.
function stallFor(ms: number) {
  vi.setSystemTime(T0 + ms)
}

test('refreshes when the tab becomes visible again after a throttled timer', () => {
  expect(latest).toBe(BOUNDARY)
  stallFor(5 * MINUTE)
  expect(latest).toBe(BOUNDARY)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(latest).toBe(BOUNDARY + 5 * MINUTE)
})

test('refreshes when the window regains focus', () => {
  stallFor(3 * MINUTE)
  act(() => {
    window.dispatchEvent(new Event('focus'))
  })
  expect(latest).toBe(BOUNDARY + 3 * MINUTE)
})

test('ignores a visibility change that hides the tab', () => {
  stallFor(2 * MINUTE)
  visibility = 'hidden'
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  expect(latest).toBe(BOUNDARY)
})
