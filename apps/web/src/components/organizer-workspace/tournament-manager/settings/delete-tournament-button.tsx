import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { Trash2 } from 'lucide-react'
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
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

export function DeleteTournamentButton({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const deleteTournament = useMutation(
    api.tournaments.lifecycle.deleteTournament,
  )
  const navigate = useNavigate()
  const [confirming, setConfirming] = useState(false)
  const [confirmationName, setConfirmationName] = useState('')
  const [busy, setBusy] = useState(false)

  const nameMatches = confirmationName.trim() === tournament.name

  async function handleDelete() {
    setBusy(true)
    try {
      await deleteTournament({ tournamentId: tournament._id })
      toast.success('Tournament deleted.')
      void navigate({ to: '/admin' })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not delete tournament.',
      )
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        onClick={() => {
          setConfirmationName('')
          setConfirming(true)
        }}
      >
        <Trash2 data-icon="inline-start" />
        Delete event
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
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete {tournament.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the event along with every registration,
              pairing, and standing. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Field>
            <FieldLabel htmlFor="delete-confirmation-name">
              Type <span className="font-semibold">{tournament.name}</span> to
              confirm
            </FieldLabel>
            <Input
              id="delete-confirmation-name"
              autoComplete="off"
              value={confirmationName}
              onChange={(event) => setConfirmationName(event.target.value)}
              disabled={busy}
            />
          </Field>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep event</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy || !nameMatches}
              onClick={(event) => {
                event.preventDefault()
                void handleDelete()
              }}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Delete forever
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
