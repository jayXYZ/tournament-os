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
//
// The form works on the match as it was when the dialog opened. If another
// staff member changes the extension, or the match's result lands, meanwhile,
// the form keeps its draft, its buttons switch off, and it asks before
// loading what is there now: a button must never change what it does under
// the pointer. The server refuses a write from a stale form regardless
// (model/timer.ts requireUnchangedExtension).
export function TimeExtensionDialog({
  row,
  finished: finishedNow,
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
  const revisionNow = row.match.timeExtensionRevision ?? 0
  const [opened, setOpened] = useState(() => ({
    revision: revisionNow,
    finished: finishedNow,
    extension: row.match.timeExtension,
  }))
  const { extension: existing, finished } = opened
  const expectedRevision = opened.revision
  const { busy, run } = useBusyAction()
  // Not while this form's own write is in flight: its result arrives just
  // before the dialog closes.
  const stale =
    !busy && (revisionNow !== opened.revision || finishedNow !== finished)
  const [minutes, setMinutes] = useState(() => draftMinutes(existing))
  const [reason, setReason] = useState(existing?.reason ?? '')
  const minutesValue = Number(minutes)
  const valid = minutes !== '' && isValidMatchTimeExtensionMinutes(minutesValue)

  function loadCurrent() {
    const extension = row.match.timeExtension
    setOpened({ revision: revisionNow, finished: finishedNow, extension })
    setMinutes(draftMinutes(extension))
    setReason(extension?.reason ?? '')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (stale) {
      return
    }
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
                    : "Its players' timers run this much past the round clock. If the round's time has already run out, they get the full amount."}
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

          {stale ? (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 text-sm"
            >
              <span>This match changed while you had this open.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadCurrent}
              >
                Load current
              </Button>
            </div>
          ) : null}

          <DialogFooter>
            {existing ? (
              <Button
                type="button"
                variant="outline"
                disabled={busy || stale}
                onClick={() => void handleRemove()}
              >
                Remove extension
              </Button>
            ) : null}
            {finished ? null : (
              <Button type="submit" disabled={busy || stale || !valid}>
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

function draftMinutes(extension: PairingRow['match']['timeExtension']) {
  return extension ? String(durationMsToMinutes(extension.extensionMs)) : '5'
}
