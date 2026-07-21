import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { Button } from '@/components/ui/button'

export function DeleteTournamentButton({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const deleteTournament = useMutation(
    api.tournaments.lifecycle.deleteTournament,
  )
  const navigate = useNavigate()

  return (
    <ConfirmActionDialog
      trigger={
        <Button type="button" variant="destructive">
          <Trash2 data-icon="inline-start" />
          Delete event
        </Button>
      }
      icon={<Trash2 />}
      destructive
      title={`Delete ${tournament.name}?`}
      description="This permanently deletes the event along with every registration, pairing, and standing. This cannot be undone."
      confirmationText={tournament.name}
      cancelLabel="Keep event"
      actionLabel="Delete forever"
      failureMessage="Could not delete tournament."
      onConfirm={async () => {
        await deleteTournament({ tournamentId: tournament._id })
        toast.success('Tournament deleted.')
        try {
          // Awaiting navigation keeps the dialog locked until the destination
          // is ready, but navigation failure must not relabel the completed
          // mutation as a failed deletion.
          await navigate({ to: '/admin' })
        } catch {
          toast.error(
            'Tournament deleted, but the tournament list could not be opened.',
          )
        }
      }}
    />
  )
}
