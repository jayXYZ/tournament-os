import { describe, expect, test } from 'vitest'
import {
  ALL_STATUSES,
  columnFiltersFromSearch,
  parseTournamentTableSearch,
  searchFromColumnFilters,
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
})

describe('columnFiltersFromSearch', () => {
  test('manage narrows to active lifecycles when the URL says nothing', () => {
    expect(columnFiltersFromSearch({}, 'manage')).toEqual([
      { id: 'status', value: ['setup', 'registration', 'in_progress'] },
    ])
    expect(columnFiltersFromSearch({}, 'public')).toEqual([])
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
