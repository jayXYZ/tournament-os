import { useMutation } from 'convex/react'
import { Globe } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { Button } from '@/components/ui/button'

export function PublishTournamentButton({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const publishTournament = useMutation(
    api.tournaments.lifecycle.publishTournament,
  )

  if (tournament.lifecycle !== 'setup') {
    return null
  }

  return (
    <ConfirmActionDialog
      trigger={
        <Button type="button" variant="outline">
          <Globe data-icon="inline-start" />
          Publish
        </Button>
      }
      icon={<Globe />}
      title={`Publish ${tournament.name}?`}
      description="Publishing opens registration. Who can see the event is controlled by its visibility setting: public events appear in listings, unlisted events are reachable by link, and private events stay hidden."
      actionLabel="Publish"
      failureMessage="Could not publish tournament."
      onConfirm={async () => {
        await publishTournament({ tournamentId: tournament._id })
        toast.success('Tournament published.')
      }}
    />
  )
}
