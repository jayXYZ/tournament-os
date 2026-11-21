import { useState } from 'react'
import { useMutation } from 'convex/react'
import { ClipboardPen, MoreHorizontal, TimerReset, Unlink } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { mutationErrorMessage } from '@paper-pairings/core'
import { EnterResultDialog } from './enter-result-dialog'
import { TimeExtensionDialog } from './time-extension-dialog'
import type { BestOf } from '@paper-pairings/shared/match-structure'
import type { PairingRow } from './pairing-row'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function ManageMatchMenu({
  row,
  bestOf,
  allowDraws,
  canEditPairings,
  canExtendTime,
}: {
  row: PairingRow
  bestOf: BestOf
  allowDraws: boolean
  canEditPairings: boolean
  /** Whether this is the live, published round the round timer runs for. */
  canExtendTime: boolean
}) {
  const isBye = row.players.some((player) => player.isBye)
  const [enteringResult, setEnteringResult] = useState(false)
  const [extendingTime, setExtendingTime] = useState(false)
  // Mirrors the backend gate (model/timer.ts setMatchTimeExtension): a bye
  // has no match time, and a finished match has none left to extend — its
  // existing extension can only be removed.
  const hasExtension = row.match.timeExtension !== undefined
  const finished =
    row.match.matchStatus === 'completed' ||
    row.match.matchStatus === 'cancelled'
  const extensionAvailable =
    canExtendTime && !isBye && (hasExtension || !finished)
  const extensionActionLabel = !hasExtension
    ? 'Add time extension'
    : finished
      ? 'Remove time extension'
      : 'Edit time extension'
  // If the match stops being extendable while the dialog is open (the round
  // completes, or its result lands and the extension is removed), the dialog
  // closes for good instead of reopening unasked when that changes back.
  if (extendingTime && !extensionAvailable) {
    setExtendingTime(false)
  }
  const breakPairing = useMutation(api.tournaments.rounds.breakPairing)

  // Mirrors the backend gate (model/manualPairing.ts): automatic results —
  // a bye's award, a drop's concession — are deleted with the pairing, but
  // an entered result refuses the break.
  const hasEnteredResult =
    row.match.matchStatus !== 'upcoming' &&
    row.match.currentResultKind !== 'bye' &&
    row.match.currentResultKind !== 'concession'

  async function handleBreakPairing() {
    try {
      await breakPairing({ matchId: row.match._id })
      toast.success(
        isBye
          ? 'Bye removed — the player is waiting to be paired.'
          : 'Pairing broken — both players are waiting to be paired.',
      )
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not break the pairing.'))
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={
              row.match.tableNumber === undefined
                ? 'Manage bye match'
                : `Manage table ${row.match.tableNumber}`
            }
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={isBye}
              onSelect={() => setEnteringResult(true)}
            >
              <ClipboardPen />
              Enter result
            </DropdownMenuItem>
            {canExtendTime ? (
              <DropdownMenuItem
                disabled={!extensionAvailable}
                onSelect={() => setExtendingTime(true)}
              >
                <TimerReset />
                {extensionActionLabel}
              </DropdownMenuItem>
            ) : null}
            {canEditPairings ? (
              <DropdownMenuItem
                variant="destructive"
                disabled={hasEnteredResult}
                onSelect={() => void handleBreakPairing()}
              >
                <Unlink />
                {isBye ? 'Break bye' : 'Break pairing'}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {enteringResult ? (
        <EnterResultDialog
          row={row}
          bestOf={bestOf}
          allowDraws={allowDraws}
          open={enteringResult}
          onOpenChange={setEnteringResult}
        />
      ) : null}

      {extendingTime ? (
        <TimeExtensionDialog
          row={row}
          finished={finished}
          open={extendingTime}
          onOpenChange={setExtendingTime}
        />
      ) : null}
    </>
  )
}
