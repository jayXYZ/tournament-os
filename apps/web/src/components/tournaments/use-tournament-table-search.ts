import * as React from 'react'
import {
  columnFiltersFromSearch,
  sameTournamentTableChips,
  sameTournamentTableSearch,
  searchFromColumnFilters,
  settleTournamentTableSearch,
} from './tournament-table-search'
import type { ColumnFiltersState, OnChangeFn } from '@tanstack/react-table'
import type { TournamentTableSearchParams } from './tournament-table-search'
import type { TournamentTableVariant } from './tournament-table'

// How long typing may pause before the search text reaches the URL.
export const SEARCH_URL_WRITE_DELAY_MS = 300

// The tournament table's toolbar state when the caller keeps it in the
// route's search params (see tournament-table-search.ts). The table answers
// from a local copy of its filters and writes the URL behind it: every
// navigation re-runs the root route's beforeLoad (a server round trip) and
// `search` only reflects the new value once that settles, so a table bound
// straight to the URL would lag — a keystroke behind while typing, and a
// chip changed while the previous chip's write was still in flight would be
// applied to the stale URL state and silently undo it. Chip changes write at
// once; only typing waits for a pause.
//
// Pass `search` and `onSearchChange` together or not at all; without them
// the table owns its state and `columnFilters` is only its starting point.
export function useTournamentTableSearch({
  search,
  onSearchChange,
  variant,
}: {
  search: TournamentTableSearchParams | undefined
  onSearchChange: ((next: TournamentTableSearchParams) => void) | undefined
  variant: TournamentTableVariant
}): {
  controlled: boolean
  columnFilters: ColumnFiltersState
  onColumnFiltersChange: OnChangeFn<ColumnFiltersState>
} {
  const controlled = search !== undefined && onSearchChange !== undefined
  const [localSearch, setLocalSearch] =
    React.useState<TournamentTableSearchParams>(() => search ?? {})
  // Writes the URL has not yet shown back, oldest first, so an arriving URL
  // can be told apart: an echo of one of these, or an external change (the
  // back button, a pasted link) the table must adopt. See
  // settleTournamentTableSearch.
  const pendingWrites = React.useRef<Array<TournamentTableSearchParams>>([])
  const writeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelPendingWrite = React.useCallback(() => {
    if (writeTimer.current !== null) {
      clearTimeout(writeTimer.current)
      writeTimer.current = null
    }
  }, [])
  React.useEffect(() => {
    if (search === undefined) {
      return
    }
    const inFlight = settleTournamentTableSearch(pendingWrites.current, search)
    if (inFlight !== null) {
      pendingWrites.current = [...inFlight]
      return
    }
    pendingWrites.current = []
    // Text typed before the URL changed under the table would otherwise
    // write over the new URL once the pause elapsed.
    cancelPendingWrite()
    setLocalSearch((current) =>
      sameTournamentTableSearch(current, search) ? current : search,
    )
  }, [search, cancelPendingWrite])
  React.useEffect(
    () => () => {
      // Leaving the page discards a pending write rather than navigating
      // back to this route to deliver it.
      cancelPendingWrite()
    },
    [cancelPendingWrite],
  )

  const columnFilters = React.useMemo<ColumnFiltersState>(
    () => columnFiltersFromSearch(controlled ? localSearch : {}, variant),
    [controlled, localSearch, variant],
  )
  const onColumnFiltersChange = React.useCallback<
    OnChangeFn<ColumnFiltersState>
  >(
    (updater) => {
      if (!onSearchChange) {
        return
      }
      const next =
        typeof updater === 'function' ? updater(columnFilters) : updater
      const params = searchFromColumnFilters(next, variant)
      setLocalSearch(params)
      cancelPendingWrite()
      const write = () => {
        writeTimer.current = null
        // A write that matches what the URL already shows (or is about to,
        // once the last write lands) is no navigation at all, so the router
        // would never echo it back; don't wait for one.
        const expected = pendingWrites.current.at(-1) ?? search
        if (
          expected !== undefined &&
          sameTournamentTableSearch(params, expected)
        ) {
          return
        }
        pendingWrites.current.push(params)
        onSearchChange(params)
      }
      // Compared through the same codec, so the manage table's implied
      // starting status (absent from the URL, present in the filters) is
      // not mistaken for a chip change on the first keystroke.
      const current = searchFromColumnFilters(columnFilters, variant)
      if (sameTournamentTableChips(params, current)) {
        writeTimer.current = setTimeout(write, SEARCH_URL_WRITE_DELAY_MS)
      } else {
        // A chip change carries any pending search text along with it.
        write()
      }
    },
    [cancelPendingWrite, columnFilters, onSearchChange, search, variant],
  )

  return { controlled, columnFilters, onColumnFiltersChange }
}
