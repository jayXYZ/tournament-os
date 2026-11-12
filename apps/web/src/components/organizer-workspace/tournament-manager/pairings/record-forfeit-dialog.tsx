import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { displayPlayerName } from '@paper-pairings/core'
import type { FormEvent } from 'react'
import type { PairingRow } from './pairing-row'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

type RegistrationId = PairingRow['players'][number]['playerId']

// A Forfeit (CONTEXT.md): the match is awarded against one player without
// play. Nobody is dropped; an absent player is a no-show instead.
export function RecordForfeitDialog({
  row,
  open,
  onOpenChange,
}: {
  row: PairingRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const recordMatchForfeit = useMutation(
    api.tournaments.rounds.recordMatchForfeit,
  )
  const { busy, run } = useBusyAction()
  const [forfeitedId, setForfeitedId] = useState<RegistrationId | null>(null)
  const [note, setNote] = useState('')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (forfeitedId === null) {
      return
    }

    await run(async () => {
      await recordMatchForfeit({
        matchId: row.match._id,
        forfeitedRegistrationId: forfeitedId,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      })
      onOpenChange(false)
      toast.success('Forfeit recorded.')
    }, 'Could not record the forfeit.')
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
            <DialogTitle>Record forfeit</DialogTitle>
            <DialogDescription>
              The forfeiting player loses the match
              {row.match.tableNumber === undefined
                ? ''
                : ` at table ${row.match.tableNumber}`}{' '}
              without play and stays in the tournament. Their opponent wins.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <RadioGroup
              aria-label="Forfeiting player"
              value={forfeitedId ?? ''}
              onValueChange={(value) => setForfeitedId(value as RegistrationId)}
              disabled={busy}
            >
              {row.players.map((player) => (
                <Field key={player.playerId} orientation="horizontal">
                  <RadioGroupItem
                    id={`forfeit-${row.match._id}-${player.playerId}`}
                    value={player.playerId}
                  />
                  <FieldLabel
                    htmlFor={`forfeit-${row.match._id}-${player.playerId}`}
                  >
                    {displayPlayerName(player.playerName)} forfeits
                  </FieldLabel>
                </Field>
              ))}
            </RadioGroup>
            <Field>
              <FieldLabel htmlFor={`forfeit-note-${row.match._id}`}>
                Note (optional)
              </FieldLabel>
              <Input
                id={`forfeit-note-${row.match._id}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Why this forfeit?"
                maxLength={500}
                disabled={busy}
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={busy || forfeitedId === null}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Record forfeit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
