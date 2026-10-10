import { tournamentFormats } from '@paper-pairings/shared/tournament-creation-utils'
import {
  activeTournamentLifecycles,
  tournamentLifecycleValues,
} from './tournament-display'
import type { ColumnFiltersState } from '@tanstack/react-table'
import type { TournamentFormat } from '@paper-pairings/shared/tournament-creation-utils'
import type { TournamentLifecycle } from './tournament-display'
import type { TournamentTableVariant } from './tournament-table'
import type { DateRangeFilterValue } from '@/components/ui/data-table'

// The tournament table's toolbar state as it lives in a route's search
// params, so filters survive a reload and the back button. Lists are
// comma-joined and dates are epoch ms, which keeps the URL readable:
//   ?q=modern&status=setup,registration&format=modern&from=1758…&to=1759…
//
// The manage table opens narrowed to the active lifecycles when the URL says
// nothing about status. An organizer who clears that chip is asking for
// every lifecycle, and the URL has to say so or a reload would re-narrow it;
// that is the `all` sentinel.
export type TournamentTableSearchParams = {
  q?: string
  status?: string
  format?: string
  from?: number
  to?: number
}

export const ALL_STATUSES = 'all'

// validateSearch: keeps only well-formed values so a hand-edited URL can
// never put the table in a state its chips cannot show. Every key is set,
// to undefined when its value is missing or malformed: the router lays a
// route's validated search over its parent's raw one, so a key merely left
// out would keep the raw value this parser meant to reject.
export function parseTournamentTableSearch(
  search: Record<string, unknown>,
): TournamentTableSearchParams {
  const params: TournamentTableSearchParams = {
    q: undefined,
    status: undefined,
    format: undefined,
    from: undefined,
    to: undefined,
  }
  if (typeof search.q === 'string' && search.q !== '') {
    params.q = search.q
  }
  if (search.status === ALL_STATUSES) {
    params.status = ALL_STATUSES
  } else {
    const status = parseList(search.status, tournamentLifecycleValues)
    if (status.length > 0) {
      params.status = status.join(',')
    }
  }
  const format = parseList(search.format, tournamentFormats)
  if (format.length > 0) {
    params.format = format.join(',')
  }
  if (isTimestamp(search.from)) {
    params.from = search.from
  }
  if (isTimestamp(search.to)) {
    params.to = search.to
  }
  return params
}

// A finite number is not enough: Date can only hold about ±8.64e15 ms, and
// a larger value would pass through to the date chip, which formats it and
// throws (RangeError: Invalid time value) on first render.
function isTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    !Number.isNaN(new Date(value).getTime())
  )
}

function parseList<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
): Array<T> {
  if (typeof value !== 'string') {
    return []
  }
  const seen = new Set<T>()
  for (const part of value.split(',')) {
    if ((allowed as ReadonlyArray<string>).includes(part)) {
      seen.add(part as T)
    }
  }
  return [...seen]
}

// Search params → the TanStack column filters the table renders from.
export function columnFiltersFromSearch(
  params: TournamentTableSearchParams,
  variant: TournamentTableVariant,
): ColumnFiltersState {
  const filters: ColumnFiltersState = []
  if (params.q) {
    filters.push({ id: 'tournament', value: params.q })
  }
  const status = statusFilterFromSearch(params.status, variant)
  if (status.length > 0) {
    filters.push({ id: 'status', value: status })
  }
  const format = parseList(params.format, tournamentFormats)
  if (format.length > 0) {
    filters.push({ id: 'format', value: format })
  }
  if (params.from !== undefined || params.to !== undefined) {
    const range: DateRangeFilterValue = { from: params.from, to: params.to }
    filters.push({ id: 'startDate', value: range })
  }
  return filters
}

function statusFilterFromSearch(
  status: string | undefined,
  variant: TournamentTableVariant,
): Array<TournamentLifecycle> {
  // The public schedule has no Status chip (its list is registration-only),
  // so a status in the URL would narrow the table with nothing to clear it.
  if (variant === 'public' || status === ALL_STATUSES) {
    return []
  }
  if (status === undefined) {
    return variant === 'manage' ? activeTournamentLifecycles : []
  }
  return parseList(status, tournamentLifecycleValues)
}

// Column filters → search params, the inverse of columnFiltersFromSearch.
// Keys the table is not filtering on come back undefined so the router
// drops them from the URL.
export function searchFromColumnFilters(
  filters: ColumnFiltersState,
  variant: TournamentTableVariant,
): TournamentTableSearchParams {
  const byId = new Map(filters.map((filter) => [filter.id, filter.value]))
  const q = byId.get('tournament')
  const status = byId.get('status')
  const format = byId.get('format')
  const range = byId.get('startDate') as DateRangeFilterValue | undefined

  const statusList = Array.isArray(status) ? (status as Array<string>) : []
  const formatList = Array.isArray(format) ? (format as Array<string>) : []
  return {
    q: typeof q === 'string' && q !== '' ? q : undefined,
    status:
      statusList.length > 0
        ? statusList.join(',')
        : variant === 'manage'
          ? ALL_STATUSES
          : undefined,
    format: formatList.length > 0 ? formatList.join(',') : undefined,
    from: range?.from,
    to: range?.to,
  }
}

// Whether two search states agree on every chip (everything but the text).
export function sameTournamentTableChips(
  left: TournamentTableSearchParams,
  right: TournamentTableSearchParams,
) {
  return (
    left.status === right.status &&
    left.format === right.format &&
    left.from === right.from &&
    left.to === right.to
  )
}

export function sameTournamentTableSearch(
  left: TournamentTableSearchParams,
  right: TournamentTableSearchParams,
) {
  return left.q === right.q && sameTournamentTableChips(left, right)
}

// The table writes its filters to the URL and only reads them back once the
// router settles, which may be after it has written again. `pending` is the
// writes not yet seen back, oldest first. When `url` echoes one of them, the
// result is what is still in flight (the echoed write and everything before
// it — superseded or settled — drops out). When it echoes none, the result
// is null: the back button or a pasted link changed the URL under the table,
// and the table must adopt it.
export function settleTournamentTableSearch(
  pending: ReadonlyArray<TournamentTableSearchParams>,
  url: TournamentTableSearchParams,
): ReadonlyArray<TournamentTableSearchParams> | null {
  const echoed = pending.findIndex((write) =>
    sameTournamentTableSearch(write, url),
  )
  return echoed === -1 ? null : pending.slice(echoed + 1)
}

export type { TournamentFormat }
