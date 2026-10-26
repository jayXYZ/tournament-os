import { useAuthedQueryArgs } from '@paper-pairings/core'
import { api } from '@paper-pairings/backend/convex/_generated/api'
import { useClientClock } from './use-client-clock'
import { useStableQuery } from './use-stable-query'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'

// The viewer's payment order for an event or convention, shared by the
// public page and the Stripe Checkout return page. Pass `null` to skip
// (e.g. a free event has no order).
//
// The order carries the cancel outcome, which reads as a promise, so its
// clock never runs behind the server's (see useClientClock's `round`). The
// args stay 'skip' until Convex has validated the viewer's token (see
// useAuthedQueryArgs), so the token-lag window reads as loading rather than
// "no order"; useStableQuery drops its held result on 'skip', so a sign-out
// never leaves the previous viewer's order on screen.

export function useMyEntryOrder(tournamentId: Id<'tournaments'> | null) {
  const now = useClientClock({ round: 'up' })
  return useStableQuery(
    api.payments.queries.getMyEntryOrder,
    useAuthedQueryArgs(tournamentId ? { tournamentId, now } : null),
  )
}

export function useMyBadgeOrder(conventionId: Id<'conventions'> | null) {
  const now = useClientClock({ round: 'up' })
  return useStableQuery(
    api.payments.queries.getMyBadgeOrder,
    useAuthedQueryArgs(conventionId ? { conventionId, now } : null),
  )
}
