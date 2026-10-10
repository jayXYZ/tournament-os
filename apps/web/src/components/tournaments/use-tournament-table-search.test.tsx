// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { parseTournamentTableSearch } from './tournament-table-search'
import {
  SEARCH_URL_WRITE_DELAY_MS,
  useTournamentTableSearch,
} from './use-tournament-table-search'
import type { ColumnFiltersState, OnChangeFn } from '@tanstack/react-table'
import type { Root } from 'react-dom/client'
import type { TournamentTableSearchParams } from './tournament-table-search'

// The hook under a router that lags: `search` is whatever the test last
// delivered, standing in for useSearch settling only after beforeLoad's
// round trip, and `writes` is every navigation the hook asked for.

let latest: {
  columnFilters: ColumnFiltersState
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>
}
const writes: Array<TournamentTableSearchParams> = []

function Probe({ search }: { search: TournamentTableSearchParams }) {
  latest = useTournamentTableSearch({
    search,
    onSearchChange: (next) => {
      writes.push(next)
    },
    variant: 'manage',
  })
  return null
}

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  writes.length = 0
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

// What the route hands back once a write lands: validateSearch re-parses it,
// dropping the keys the hook left undefined.
function urlAfter(write: TournamentTableSearchParams) {
  return parseTournamentTableSearch(write)
}

function deliverUrl(search: TournamentTableSearchParams) {
  act(() => {
    root.render(<Probe search={search} />)
  })
}

function change(updater: (filters: ColumnFiltersState) => ColumnFiltersState) {
  act(() => {
    latest.onColumnFiltersChange(updater)
  })
}

function setChip(id: string, value: unknown) {
  return (filters: ColumnFiltersState) => [
    ...filters.filter((filter) => filter.id !== id),
    { id, value },
  ]
}

function filterValue(id: string) {
  return latest.columnFilters.find((filter) => filter.id === id)?.value
}

test('a chip changed while the previous write is still in flight keeps both', () => {
  deliverUrl({})
  expect(filterValue('status')).toEqual([
    'setup',
    'registration',
    'in_progress',
  ])

  change(setChip('format', ['modern']))
  // The URL has not caught up with the Format write yet.
  change(setChip('status', ['completed']))

  expect(filterValue('format')).toEqual(['modern'])
  expect(filterValue('status')).toEqual(['completed'])
  expect(writes).toHaveLength(2)
  expect(writes[1]).toMatchObject({ format: 'modern', status: 'completed' })

  // The two navigations settle in order; neither echo undoes the newer one.
  deliverUrl(urlAfter(writes[0]))
  expect(filterValue('format')).toEqual(['modern'])
  expect(filterValue('status')).toEqual(['completed'])
  deliverUrl(urlAfter(writes[1]))
  expect(filterValue('format')).toEqual(['modern'])
  expect(filterValue('status')).toEqual(['completed'])
  expect(writes).toHaveLength(2)

  // The back button is not an echo: the table adopts it.
  deliverUrl({ format: 'draft' })
  expect(filterValue('format')).toEqual(['draft'])
  expect(filterValue('status')).toEqual([
    'setup',
    'registration',
    'in_progress',
  ])
})

test('the router may skip a superseded write; the newer echo still settles', () => {
  deliverUrl({})
  change(setChip('format', ['modern']))
  change(setChip('format', ['modern', 'draft']))
  expect(writes).toHaveLength(2)

  // Only the second navigation commits.
  deliverUrl(urlAfter(writes[1]))
  expect(filterValue('format')).toEqual(['modern', 'draft'])

  // Nothing is left pending, so the next URL change is external and wins.
  deliverUrl({})
  expect(filterValue('format')).toBeUndefined()
})

test('typing waits for a pause and a chip change carries the text with it', () => {
  deliverUrl({})
  change(setChip('tournament', 'cu'))
  change(setChip('tournament', 'cup'))
  expect(filterValue('tournament')).toBe('cup')
  expect(writes).toHaveLength(0)

  act(() => {
    vi.advanceTimersByTime(SEARCH_URL_WRITE_DELAY_MS)
  })
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ q: 'cup' })

  change(setChip('tournament', 'cups'))
  change(setChip('format', ['sealed']))
  expect(writes).toHaveLength(2)
  expect(writes[1]).toMatchObject({ q: 'cups', format: 'sealed' })
  act(() => {
    vi.advanceTimersByTime(SEARCH_URL_WRITE_DELAY_MS)
  })
  expect(writes).toHaveLength(2)
})

test('a URL change under pending typing discards the typing', () => {
  deliverUrl({})
  change(setChip('tournament', 'cu'))
  deliverUrl({ format: 'draft' })
  act(() => {
    vi.advanceTimersByTime(SEARCH_URL_WRITE_DELAY_MS)
  })
  expect(writes).toHaveLength(0)
  expect(filterValue('tournament')).toBeUndefined()
  expect(filterValue('format')).toEqual(['draft'])
})

test('a write the URL already shows is not waited for', () => {
  deliverUrl({ format: 'modern', status: 'all' })
  change(setChip('format', ['draft']))
  change(setChip('format', ['modern']))
  expect(writes).toHaveLength(2)

  deliverUrl(urlAfter(writes[0]))
  deliverUrl({ format: 'modern', status: 'all' })
  // Clearing Format now is a real change again and must navigate.
  change(setChip('format', undefined))
  expect(writes).toHaveLength(3)
  expect(writes[2].format).toBeUndefined()
})
