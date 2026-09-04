import { useMutation } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { isPreStartLocked } from './is-pre-start-locked'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import type { PaidEventFeeCopy } from '@/components/organizer-workspace/paid-event/fee-card'
import { PaidEventFeeCard } from '@/components/organizer-workspace/paid-event/fee-card'

const copy: PaidEventFeeCopy = {
  title: 'Entry fee',
  lockedDescription:
    'Entry fee settings are locked after tournament play begins.',
  description:
    'Charge players to register. You are paid out exactly the entry cost per paid player; players additionally cover the platform and payment processing fees.',
  feeLabel: 'Entry cost (USD)',
  feeEmptyHint: 'Leave empty for a free event.',
  refundDeadlineDescription:
    'Players who unregister before this time are refunded in full. Leave empty to allow refunds until the tournament starts.',
  payersLabel: 'Players',
  paidOutLabel: 'entry',
  feePhrase: 'an entry fee',
  invalidFeeMessage: 'Enter a valid entry fee.',
  saveLabel: 'Save entry fee',
  savedMessage: 'Entry fee settings saved.',
  saveFailedMessage: 'Could not save entry fee settings.',
}

export function EntryFeeCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const updateTournamentSetup = useMutation(
    api.tournaments.lifecycle.updateTournamentSetup,
  )

  return (
    <PaidEventFeeCard
      paidEvent={tournament}
      locked={isPreStartLocked(tournament)}
      idPrefix="settings"
      copy={copy}
      onSave={async ({ entryFeeCents, refundDeadline }) => {
        await updateTournamentSetup({
          tournamentId: tournament._id,
          entryFeeCents,
          refundDeadline,
        })
      }}
    />
  )
}
