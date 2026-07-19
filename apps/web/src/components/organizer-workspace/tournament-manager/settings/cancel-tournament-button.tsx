import { useState } from 'react'
import { useMutation } from 'convex/react'
import { Ban } from 'lucide-react'
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

export function CancelTournamentButton({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const cancelTournament = useMutation(
    api.tournaments.lifecycle.cancelTournament,
  )
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function handleCancel() {
    setBusy(true)
    try {
      await cancelTournament({ tournamentId: tournament._id })
      setConfirming(false)
      toast.success('Tournament cancelled.')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not cancel tournament.',
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
        <Ban data-icon="inline-start" />
        Cancel event
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
            <AlertDialogMedia className="text-destructive">
              <Ban />
            </AlertDialogMedia>
            <AlertDialogTitle>Cancel {tournament.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The event ends immediately and no further rounds can be played.
              Registered players will see the event as cancelled. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep event</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void handleCancel()
              }}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Cancel event
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
