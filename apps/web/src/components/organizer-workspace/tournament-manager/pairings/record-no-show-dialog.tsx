import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { displayPlayerName } from '@paper-pairings/core'
import type { FormEvent } from 'react'
import type { PairingRow } from './pairing-row'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

type RegistrationId = PairingRow['players'][number]['playerId']

// A No-Show (CONTEXT.md): a match loss for each absent player, who is also
// dropped unless the organizer keeps them in. Both absent is a double match
// loss.
export function RecordNoShowDialog({
  row,
  // In a bracket a double loss advances nobody. The dialog says so before
  // the organizer commits to it.
  isBracket,
  open,
  onOpenChange,
}: {
  row: PairingRow
  isBracket: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const recordMatchNoShow = useMutation(
    api.tournaments.rounds.recordMatchNoShow,
  )
  const { busy, run } = useBusyAction()
  const [absentIds, setAbsentIds] = useState<Array<RegistrationId>>([])
  const [keepInTournament, setKeepInTournament] = useState(false)
  const [note, setNote] = useState('')

  const doubleLoss = absentIds.length === 2

  function toggleAbsent(playerId: RegistrationId, checked: boolean) {
    setAbsentIds((current) =>
      checked
        ? [...current.filter((id) => id !== playerId), playerId]
        : current.filter((id) => id !== playerId),
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (absentIds.length === 0) {
      return
    }

    await run(async () => {
      await recordMatchNoShow({
        matchId: row.match._id,
        absentRegistrationIds: absentIds,
        ...(keepInTournament ? { keepInTournament: true } : {}),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      })
      onOpenChange(false)
      toast.success('No-show recorded.')
    }, 'Could not record the no-show.')
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
            <DialogTitle>Record no-show</DialogTitle>
            <DialogDescription>
              An absent player loses the match
              {row.match.tableNumber === undefined
                ? ''
                : ` at table ${row.match.tableNumber}`}{' '}
              without play
              {keepInTournament
                ? ' and stays in the tournament.'
                : ' and is dropped from the tournament.'}
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            {row.players.map((player) => (
              <Field key={player.playerId} orientation="horizontal">
                <Checkbox
                  id={`no-show-${row.match._id}-${player.playerId}`}
                  checked={absentIds.includes(player.playerId)}
                  onCheckedChange={(checked) =>
                    toggleAbsent(player.playerId, checked === true)
                  }
                  disabled={busy}
                />
                <FieldLabel
                  htmlFor={`no-show-${row.match._id}-${player.playerId}`}
                >
                  {displayPlayerName(player.playerName)} is absent
                </FieldLabel>
              </Field>
            ))}
            {doubleLoss ? (
              <FieldDescription role="status">
                {isBracket
                  ? 'Both players take a match loss and nobody advances from this match.'
                  : 'Both players take a match loss.'}
              </FieldDescription>
            ) : null}
            <Field orientation="horizontal">
              <Checkbox
                id={`no-show-keep-${row.match._id}`}
                checked={keepInTournament}
                onCheckedChange={(checked) =>
                  setKeepInTournament(checked === true)
                }
                disabled={busy}
              />
              <FieldLabel htmlFor={`no-show-keep-${row.match._id}`}>
                Keep in the tournament instead of dropping
              </FieldLabel>
            </Field>
            <Field>
              <FieldLabel htmlFor={`no-show-note-${row.match._id}`}>
                Note (optional)
              </FieldLabel>
              <Input
                id={`no-show-note-${row.match._id}`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Context for the log"
                maxLength={500}
                disabled={busy}
              />
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={busy || absentIds.length === 0}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Record no-show
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
