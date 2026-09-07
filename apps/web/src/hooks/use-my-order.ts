import { useAuthedQueryArgs } from '@tournament-os/core'
import { api } from '@tournament-os/backend/convex/_generated/api'
import { useTimedQuery } from './use-timed-query'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'

export function useMyEntryOrder(tournamentId: Id<'tournaments'> | null) {
  return useTimedQuery(
    api.payments.queries.getMyEntryOrder,
    useAuthedQueryArgs(tournamentId ? { tournamentId } : null),
  )
}

export function useMyBadgeOrder(conventionId: Id<'conventions'> | null) {
  return useTimedQuery(
    api.payments.queries.getMyBadgeOrder,
    useAuthedQueryArgs(conventionId ? { conventionId } : null),
  )
}
