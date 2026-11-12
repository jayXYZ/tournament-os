import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import type { FormEvent } from 'react'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { useBusyAction } from '@/hooks/use-busy-action'

const REASON_MAX_LENGTH = 1000

// A Disqualification (CONTEXT.md): removal from the tournament and its
// standings, with no way back. The dialog spells out what confirming does,
// because nothing in the roster undoes it. Controlled by the caller, since
// the menu item that opens it unmounts on select.
export function DisqualifyPlayerDialog({
  open,
  onOpenChange,
  registrationId,
  playerName,
  // Whether the player has an unresolved match in the open round, which the
  // disqualification records as a loss — the same server fact the drop
  // dialog warns from.
  losesCurrentMatch,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  registrationId: Id<'tournamentRegistrations'>
  playerName: string
  losesCurrentMatch: boolean
}) {
  const disqualifyRegistration = useMutation(
    api.tournaments.registrations.disqualifyRegistration,
  )
  const { busy, run } = useBusyAction()
  const [reason, setReason] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      await disqualifyRegistration({
        registrationId,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      })
      onOpenChange(false)
      setReason('')
      toast.success(`${playerName} has been disqualified.`)
    }, 'Could not disqualify player.')
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) {
          onOpenChange(nextOpen)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Disqualify {playerName}?</DialogTitle>
            <DialogDescription>
              They are removed from the tournament and from the standings, and
              every player ranked below them moves up a place.{' '}
              {losesCurrentMatch
                ? 'Their unfinished match this round is recorded as a loss.'
                : 'Their finished matches stay on record.'}{' '}
              This cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`disqualify-reason-${registrationId}`}>
                Reason (optional)
              </FieldLabel>
              <Textarea
                id={`disqualify-reason-${registrationId}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="What happened, and the infraction if there is one"
                maxLength={REASON_MAX_LENGTH}
                disabled={busy}
              />
              <FieldDescription>
                Kept in the activity log for organizers. Players never see it.
              </FieldDescription>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Disqualify player
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
