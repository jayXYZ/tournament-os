import { useAction, useQuery } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
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
  const retryPayout = useAction(api.payments.payouts.retryPayout)

  return (
    <PaidEventPayoutCard
      isPaid={ticketTypes?.some((t) => t.priceCents > 0) ?? false}
      completed={convention.lifecycle === 'completed'}
      payout={payout}
      onRetry={() => retryPayout({ conventionId: convention._id })}
      copy={copy}
    />
  )
}
