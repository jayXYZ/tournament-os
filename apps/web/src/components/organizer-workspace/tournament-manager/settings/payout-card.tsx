import { useAction, useMutation, useQuery } from 'convex/react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { PaidEventPayoutCopy } from '@/components/organizer-workspace/paid-event/payout-card'
import { PaidEventPayoutCard } from '@/components/organizer-workspace/paid-event/payout-card'

const copy: PaidEventPayoutCopy = {
  title: 'Entry fee payout',
  description:
    "Entry fees are transferred to the organization's Stripe account when the tournament completes.",
  pendingMessage:
    'The payout runs automatically once the tournament is completed.',
  feesLabel: 'entry fees',
}

export function PayoutCard({ tournament }: { tournament: Doc<'tournaments'> }) {
  const payout = useQuery(
    api.payments.payouts.getTournamentPayout,
    tournament.lifecycle === 'completed'
      ? { tournamentId: tournament._id }
      : 'skip',
  )
  const refundsNeedingAttention = useQuery(
    api.payments.refunds.listRefundsNeedingAttention,
    (tournament.entryFeeCents ?? 0) > 0
      ? { tournamentId: tournament._id }
      : 'skip',
  )
  const retryPayout = useAction(api.payments.payouts.retryPayout)
  const retryRefund = useMutation(api.payments.refunds.retryRefund)

  return (
    <PaidEventPayoutCard
      isPaid={(tournament.entryFeeCents ?? 0) > 0}
      completed={tournament.lifecycle === 'completed'}
      payout={payout}
      refundsNeedingAttention={refundsNeedingAttention}
      onRetry={() => retryPayout({ tournamentId: tournament._id })}
      onRetryRefund={(refundId) => retryRefund({ refundId })}
      copy={copy}
    />
  )
}
