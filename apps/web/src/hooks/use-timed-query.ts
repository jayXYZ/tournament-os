import { useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import type { OptionalRestArgsOrSkip } from 'convex/react'
import type { FunctionArgs, FunctionReference } from 'convex/server'

type Refreshable = { refreshAt: number | null }
type TimedQuery = FunctionReference<
  'query',
  'public',
  { now: number },
  Refreshable | Array<Refreshable> | null
>

// Time is an explicit query input. The server supplies the next boundary;
// refreshing only there avoids polling a payment or ticket query every second.
export function useTimedQuery<TQuery extends TimedQuery>(
  query: TQuery,
  args: Omit<FunctionArgs<TQuery>, 'now'> | 'skip',
) {
  const [now, setNow] = useState(Date.now)
  const result = useQuery(
    query,
    ...([
      args === 'skip' ? 'skip' : { ...args, now },
    ] as OptionalRestArgsOrSkip<TQuery>),
  )
  const rows = result == null ? [] : Array.isArray(result) ? result : [result]
  const deadlines = rows.flatMap((row: Refreshable) =>
    row.refreshAt === null ? [] : [row.refreshAt],
  )
  const next = deadlines.length ? Math.min(...deadlines) : null

  const skipped = args === 'skip'
  useEffect(() => {
    if (skipped) return
    const refresh = () => setNow(Date.now())
    // setTimeout overflows after ~25 days. Recheck long deadlines in chunks.
    const timer =
      next === null
        ? undefined
        : setTimeout(
            refresh,
            Math.min(2_147_483_647, Math.max(0, next - Date.now())),
          )
    window.addEventListener('focus', refresh)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [skipped, next, now])

  return result
}
