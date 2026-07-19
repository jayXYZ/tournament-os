import { useState } from 'react'
import { useMutation } from 'convex/react'
import { Globe } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

export function PublishTournamentButton({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const publishTournament = useMutation(
    api.tournaments.lifecycle.publishTournament,
  )
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  if (tournament.lifecycle !== 'setup') {
    return null
  }

  async function handlePublish() {
    setBusy(true)
    try {
      await publishTournament({ tournamentId: tournament._id })
      setConfirming(false)
      toast.success('Tournament published.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not publish tournament.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setConfirming(true)}
      >
        <Globe data-icon="inline-start" />
        Publish
      </Button>

      <AlertDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!busy) {
            setConfirming(open)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Globe />
            </AlertDialogMedia>
            <AlertDialogTitle>Publish {tournament.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Publishing opens registration. Who can see the event is controlled
              by its visibility setting: public events appear in listings,
              unlisted events are reachable by link, and private events stay
              hidden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void handlePublish()
              }}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
