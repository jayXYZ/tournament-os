import { useAction, useQuery } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
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
  const retryPayout = useAction(api.payments.payouts.retryPayout)

  return (
    <PaidEventPayoutCard
      isPaid={(tournament.entryFeeCents ?? 0) > 0}
      completed={tournament.lifecycle === 'completed'}
      payout={payout}
      onRetry={() => retryPayout({ tournamentId: tournament._id })}
      copy={copy}
    />
  )
}
