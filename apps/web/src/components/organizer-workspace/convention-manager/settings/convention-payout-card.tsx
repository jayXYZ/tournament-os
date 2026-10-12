import { useAction, useMutation, useQuery } from 'convex/react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { PaidEventPayoutCopy } from '@/components/organizer-workspace/paid-event/payout-card'
import { PaidEventPayoutCard } from '@/components/organizer-workspace/paid-event/payout-card'

const copy: PaidEventPayoutCopy = {
  title: 'Badge fee payout',
  description:
    "Badge fees are transferred to the organization's Stripe account when the convention completes.",
  pendingMessage:
    'The payout runs automatically once the convention is completed.',
  feesLabel: 'badge fees',
}

export function ConventionPayoutCard({
  convention,
}: {
  convention: Doc<'conventions'>
}) {
  const payout = useQuery(
    api.payments.payouts.getConventionPayout,
    convention.lifecycle === 'completed'
      ? { conventionId: convention._id }
      : 'skip',
  )
  // Paid-ness lives on the ticket types now (ADR 0004).
  const ticketTypes = useQuery(
    api.conventions.ticketTypes.listTicketTypesForOrganizer,
    { conventionId: convention._id },
  )
  const isPaid = ticketTypes?.some((t) => t.priceCents > 0) ?? false
  const refundsNeedingAttention = useQuery(
    api.payments.refunds.listRefundsNeedingAttention,
    isPaid ? { conventionId: convention._id } : 'skip',
  )
  const retryPayout = useAction(api.payments.payouts.retryPayout)
  const retryRefund = useMutation(api.payments.refunds.retryRefund)

  return (
    <PaidEventPayoutCard
      isPaid={isPaid}
      completed={convention.lifecycle === 'completed'}
      payout={payout}
      refundsNeedingAttention={refundsNeedingAttention}
      onRetry={() => retryPayout({ conventionId: convention._id })}
      onRetryRefund={(refundId) => retryRefund({ refundId })}
      copy={copy}
    />
  )
}
