import { describe, expect, test } from 'vitest'
import {
  ALL_STATUSES,
  columnFiltersFromSearch,
  parseTournamentTableSearch,
  searchFromColumnFilters,
  settleTournamentTableSearch,
} from './tournament-table-search'

describe('parseTournamentTableSearch', () => {
  test('keeps well-formed values and drops the rest', () => {
    expect(
      parseTournamentTableSearch({
        q: 'modern',
        status: 'setup,bogus,registration,setup',
        format: 'modern,nonsense',
        from: 1_700_000_000_000,
        to: 'soon',
      }),
    ).toEqual({
      q: 'modern',
      status: 'setup,registration',
      format: 'modern',
      from: 1_700_000_000_000,
    })
  })

  test('passes the all-statuses sentinel through', () => {
    expect(parseTournamentTableSearch({ status: ALL_STATUSES })).toEqual({
      status: ALL_STATUSES,
    })
  })

  test('drops dates outside the range Date can hold', () => {
    // Finite, but past ±8.64e15: `new Date(x)` is Invalid Date and the date
    // chip would throw formatting it.
    expect(parseTournamentTableSearch({ from: 1e20, to: -1e20 })).toEqual({})
    expect(
      parseTournamentTableSearch({ from: Infinity, to: Number.NaN }),
    ).toEqual({})
    expect(parseTournamentTableSearch({ from: 0, to: 8.64e15 })).toEqual({
      from: 0,
      to: 8.64e15,
    })
  })

  test('sets every key so a rejected raw value cannot survive the router merge', () => {
    // The router lays the validated search over the parent's raw one; an
    // omitted key would keep the very value the parser rejected.
    expect(Object.keys(parseTournamentTableSearch({ from: 1e20 }))).toEqual([
      'q',
      'status',
      'format',
      'from',
      'to',
    ])
  })
})

describe('settleTournamentTableSearch', () => {
  const first = { status: ALL_STATUSES, format: 'modern' }
  const second = { status: 'setup', format: 'modern' }

  test('an echoed write settles itself and everything before it', () => {
    expect(settleTournamentTableSearch([first, second], first)).toEqual([
      second,
    ])
    // The router may skip straight to the newer write; the superseded one
    // is never coming back and must not linger as pending.
    expect(settleTournamentTableSearch([first, second], second)).toEqual([])
  })

  test('compares by value, text included', () => {
    expect(
      settleTournamentTableSearch([{ ...first, q: 'cup' }], { ...first }),
    ).toBeNull()
    expect(
      settleTournamentTableSearch([{ ...first, q: 'cup' }], {
        q: 'cup',
        format: 'modern',
        status: ALL_STATUSES,
      }),
    ).toEqual([])
  })

  test('a URL that echoes no write is an external change', () => {
    expect(settleTournamentTableSearch([first], { format: 'draft' })).toBeNull()
    expect(settleTournamentTableSearch([], first)).toBeNull()
  })
})

describe('columnFiltersFromSearch', () => {
  test('manage narrows to active lifecycles when the URL says nothing', () => {
    expect(columnFiltersFromSearch({}, 'manage')).toEqual([
      { id: 'status', value: ['setup', 'registration', 'in_progress'] },
    ])
    expect(columnFiltersFromSearch({}, 'public')).toEqual([])
  })

  test('public ignores a status in the URL since it has no chip to clear it', () => {
    expect(columnFiltersFromSearch({ status: 'completed' }, 'public')).toEqual(
      [],
    )
    expect(
      columnFiltersFromSearch({ status: 'completed' }, 'registered'),
    ).toEqual([{ id: 'status', value: ['completed'] }])
  })

  test('the sentinel means no status filter at all', () => {
    expect(columnFiltersFromSearch({ status: ALL_STATUSES }, 'manage')).toEqual(
      [],
    )
  })

  test('builds every filter the toolbar can hold', () => {
    expect(
      columnFiltersFromSearch(
        { q: 'cup', status: 'completed', format: 'draft', from: 1, to: 2 },
        'manage',
      ),
    ).toEqual([
      { id: 'tournament', value: 'cup' },
      { id: 'status', value: ['completed'] },
      { id: 'format', value: ['draft'] },
      { id: 'startDate', value: { from: 1, to: 2 } },
    ])
  })
})

describe('searchFromColumnFilters', () => {
  test('round-trips through the URL shape', () => {
    const params = {
      q: 'cup',
      status: 'completed,cancelled',
      format: 'draft,sealed',
      from: 1,
      to: 2,
    }
    expect(
      searchFromColumnFilters(
        columnFiltersFromSearch(params, 'manage'),
        'manage',
      ),
    ).toEqual(params)
  })

  test('a cleared status chip on manage writes the sentinel', () => {
    expect(searchFromColumnFilters([], 'manage')).toEqual({
      q: undefined,
      status: ALL_STATUSES,
      format: undefined,
      from: undefined,
      to: undefined,
    })
    expect(searchFromColumnFilters([], 'public').status).toBeUndefined()
  })
})
