import { useMutation } from 'convex/react'
import { Ban } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { Button } from '@/components/ui/button'

export function CancelTournamentButton({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const cancelTournament = useMutation(
    api.tournaments.lifecycle.cancelTournament,
  )

  return (
    <ConfirmActionDialog
      trigger={
        <Button type="button" variant="outline">
          <Ban data-icon="inline-start" />
          Cancel event
        </Button>
      }
      icon={<Ban />}
      destructive
      title={`Cancel ${tournament.name}?`}
      description="The event ends immediately and no further rounds can be played. Registered players will see the event as cancelled. This cannot be undone."
      cancelLabel="Keep event"
      actionLabel="Cancel event"
      failureMessage="Could not cancel tournament."
      onConfirm={async () => {
        await cancelTournament({ tournamentId: tournament._id })
        toast.success('Tournament cancelled.')
      }}
    />
  )
}
