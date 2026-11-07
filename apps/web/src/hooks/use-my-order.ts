import {
  useAuthedQueryArgs,
  useMyEntryOrder as useSharedMyEntryOrder,
  useStableQuery,
} from '@paper-pairings/core'
import { api } from '@paper-pairings/backend/convex/_generated/api'
import { useClientClock } from './use-client-clock'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'

// The viewer's payment order for an event or convention, shared by the
// public page and the Stripe Checkout return page. Pass `null` to skip
// (e.g. a free event has no order); the clock then stands still too, so a
// skipped order never re-renders its surface once a minute.
//
// The order carries the cancel outcome, which reads as a promise, so its
// clock never runs behind the server's (see useClientClock's `round`). The
// args stay 'skip' until Convex has validated the viewer's token (see
// useAuthedQueryArgs), so the token-lag window reads as loading rather than
// "no order"; useStableQuery drops its held result on 'skip', so a sign-out
// never leaves the previous viewer's order on screen.

// The shared entry-order hook (@paper-pairings/core useMyEntryOrder) with the
// web's clock bound to it.
export function useMyEntryOrder(tournamentId: Id<'tournaments'> | null) {
  return useSharedMyEntryOrder(
    tournamentId,
    useClientClock({ round: 'up', enabled: tournamentId !== null }),
  )
}

export function useMyBadgeOrder(conventionId: Id<'conventions'> | null) {
  const now = useClientClock({ round: 'up', enabled: conventionId !== null })
  return useStableQuery(
    api.payments.queries.getMyBadgeOrder,
    useAuthedQueryArgs(conventionId ? { conventionId, now } : null),
  )
}
