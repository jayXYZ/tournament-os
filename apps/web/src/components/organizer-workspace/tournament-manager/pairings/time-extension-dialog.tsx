import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import {
  MAX_MATCH_TIME_EXTENSION_MINUTES,
  MIN_MATCH_TIME_EXTENSION_MINUTES,
  durationMsToMinutes,
  isValidMatchTimeExtensionMinutes,
} from '@paper-pairings/shared/timer-utils'
import { ScoreSlipPlayers } from './score-slip'
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
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

const MAX_REASON_LENGTH = 200

// Grant, edit, or remove one match's time extension (CONTEXT.md "Match Time
// Extension"). The players' timers shift by the saved amount; everyone
// else's stay on the round clock.
export function TimeExtensionDialog({
  row,
  open,
  onOpenChange,
}: {
  row: PairingRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const setExtension = useMutation(api.tournaments.timer.setMatchTimeExtension)
  const clearExtension = useMutation(
    api.tournaments.timer.clearMatchTimeExtension,
  )
  const existing = row.match.timeExtension
  const { busy, run } = useBusyAction()
  const [minutes, setMinutes] = useState(
    existing ? String(durationMsToMinutes(existing.extensionMs)) : '5',
  )
  const [reason, setReason] = useState(existing?.reason ?? '')
  const minutesValue = Number(minutes)
  const valid = minutes !== '' && isValidMatchTimeExtensionMinutes(minutesValue)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      await setExtension({
        matchId: row.match._id,
        minutes: minutesValue,
        ...(reason.trim() === '' ? {} : { reason: reason.trim() }),
      })
      onOpenChange(false)
      toast.success(
        existing ? 'Time extension updated.' : 'Time extension granted.',
      )
    }, 'Could not save the time extension.')
  }

  async function handleRemove() {
    await run(async () => {
      await clearExtension({ matchId: row.match._id })
      onOpenChange(false)
      toast.success('Time extension removed.')
    }, 'Could not remove the time extension.')
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
            <DialogTitle>
              {existing ? 'Edit time extension' : 'Add time extension'}
            </DialogTitle>
            <DialogDescription>
              Extra time for this match only
              {row.match.tableNumber === undefined
                ? ''
                : ` at table ${row.match.tableNumber}`}
              . Its players&apos; timers run this much past the round clock.
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm">
            <ScoreSlipPlayers row={row} layout="inline" />
          </div>

          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
              <Field>
                <FieldLabel htmlFor={`extension-minutes-${row.match._id}`}>
                  Minutes
                </FieldLabel>
                <Input
                  id={`extension-minutes-${row.match._id}`}
                  value={minutes}
                  onChange={(event) => setMinutes(event.target.value)}
                  type="number"
                  min={MIN_MATCH_TIME_EXTENSION_MINUTES}
                  max={MAX_MATCH_TIME_EXTENSION_MINUTES}
                  step={1}
                  disabled={busy}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`extension-reason-${row.match._id}`}>
                  Reason (optional)
                </FieldLabel>
                <Input
                  id={`extension-reason-${row.match._id}`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Judge call, deck check…"
                  maxLength={MAX_REASON_LENGTH}
                  disabled={busy}
                />
              </Field>
            </div>
          </FieldGroup>

          {!valid ? (
            <p role="status" className="text-sm text-muted-foreground">
              Enter whole minutes from {MIN_MATCH_TIME_EXTENSION_MINUTES} to{' '}
              {MAX_MATCH_TIME_EXTENSION_MINUTES}.
            </p>
          ) : null}

          <DialogFooter>
            {existing ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void handleRemove()}
              >
                Remove extension
              </Button>
            ) : null}
            <Button type="submit" disabled={busy || !valid}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              {existing ? 'Save extension' : 'Add extension'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
