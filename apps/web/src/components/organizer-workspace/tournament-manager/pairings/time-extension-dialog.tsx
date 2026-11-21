import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import {
  MAX_MATCH_TIME_EXTENSION_MINUTES,
  MAX_MATCH_TIME_EXTENSION_REASON_LENGTH,
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

// Grant, edit, or remove one match's time extension (CONTEXT.md "Match Time
// Extension"). The players' timers shift by the saved amount; everyone
// else's stay on the round clock. A finished match takes no new time, so its
// dialog only removes the extension it already has.
export function TimeExtensionDialog({
  row,
  finished,
  open,
  onOpenChange,
}: {
  row: PairingRow
  finished: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const setExtension = useMutation(api.tournaments.timer.setMatchTimeExtension)
  const clearExtension = useMutation(
    api.tournaments.timer.clearMatchTimeExtension,
  )
  const existing = row.match.timeExtension
  // The server refuses the write if the extension changed after this form
  // read it (model/timer.ts requireUnchangedExtension).
  const expectedRevision = row.match.timeExtensionRevision ?? 0
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
        expectedRevision,
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
      await clearExtension({ matchId: row.match._id, expectedRevision })
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
              {!existing
                ? 'Add time extension'
                : finished
                  ? 'Remove time extension'
                  : 'Edit time extension'}
            </DialogTitle>
            <DialogDescription>
              {finished ? (
                'This match is finished, so its extension can only be removed.'
              ) : (
                <>
                  Extra time for this match only
                  {row.match.tableNumber === undefined
                    ? ''
                    : ` at table ${row.match.tableNumber}`}
                  .{' '}
                  {existing
                    ? "Changing the minutes moves its players' deadline by the difference. It does not restart their countdown."
                    : "Its players' timers run this much past the round clock, or this much from now if the round's time has already run out."}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="text-sm">
            <ScoreSlipPlayers row={row} layout="inline" />
          </div>

          {finished ? null : (
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
                    maxLength={MAX_MATCH_TIME_EXTENSION_REASON_LENGTH}
                    disabled={busy}
                  />
                </Field>
              </div>
            </FieldGroup>
          )}

          {!finished && !valid ? (
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
            {finished ? null : (
              <Button type="submit" disabled={busy || !valid}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                {existing ? 'Save extension' : 'Add extension'}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
