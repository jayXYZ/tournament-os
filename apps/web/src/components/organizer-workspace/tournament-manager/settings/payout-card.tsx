import { useAction, usePaginatedQuery, useQuery } from 'convex/react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { PaidEventPayoutCopy } from '@/components/organizer-workspace/paid-event/payout-card'
import {
  PaidEventPayoutCard,
  REFUNDS_NEEDING_ATTENTION_PAGE_SIZE,
} from '@/components/organizer-workspace/paid-event/payout-card'

const copy: PaidEventPayoutCopy = {
  title: 'Entry fee payout',
  description:
    "Entry fees are transferred to the organization's Stripe account when the tournament completes.",
  pendingMessage:
    'The payout runs automatically once the tournament is completed.',
  feesLabel: 'entry fees',
}

export function PayoutCard({ tournament }: { tournament: Doc<'tournaments'> }) {
  const isPaid = (tournament.entryFeeCents ?? 0) > 0
  const payout = useQuery(
    api.payments.payouts.getTournamentPayout,
    tournament.lifecycle === 'completed'
      ? { tournamentId: tournament._id }
      : 'skip',
  )
  // The two refund lists page on their own, so a processing refund is
  // reachable however many parked ones sit before it.
  const unresolvedRefunds = usePaginatedQuery(
    api.payments.refunds.listRefundsNeedingAttention,
    isPaid
      ? { tournamentId: tournament._id, status: 'needs_attention' }
      : 'skip',
    { initialNumItems: REFUNDS_NEEDING_ATTENTION_PAGE_SIZE },
  )
  const processingRefunds = usePaginatedQuery(
    api.payments.refunds.listRefundsNeedingAttention,
    isPaid ? { tournamentId: tournament._id, status: 'pending' } : 'skip',
    { initialNumItems: REFUNDS_NEEDING_ATTENTION_PAGE_SIZE },
  )
  const retryPayout = useAction(api.payments.payouts.retryPayout)
  const checkRefundStatus = useAction(api.payments.refunds.checkRefundStatus)

  return (
    <PaidEventPayoutCard
      isPaid={isPaid}
      completed={tournament.lifecycle === 'completed'}
      payout={payout}
      unresolvedRefunds={unresolvedRefunds}
      processingRefunds={processingRefunds}
      onRetry={() => retryPayout({ tournamentId: tournament._id })}
      onCheckRefund={(refundId) => checkRefundStatus({ refundId })}
      copy={copy}
    />
  )
}
