import { useState } from 'react'
import { useMutation } from 'convex/react'
import { ClipboardPen, Flag, MoreHorizontal, Unlink, UserX } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { mutationErrorMessage } from '@paper-pairings/core'
import { EnterResultDialog } from './enter-result-dialog'
import { RecordForfeitDialog } from './record-forfeit-dialog'
import { RecordNoShowDialog } from './record-no-show-dialog'
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
}: {
  row: PairingRow
  bestOf: BestOf
  allowDraws: boolean
  canEditPairings: boolean
}) {
  const isBye = row.players.some((player) => player.isBye)
  const [enteringResult, setEnteringResult] = useState(false)
  const [recordingNoShow, setRecordingNoShow] = useState(false)
  const [recordingForfeit, setRecordingForfeit] = useState(false)
  const breakPairing = useMutation(api.tournaments.rounds.breakPairing)

  // Mirrors the backend gate (model/manualPairing.ts): automatic results —
  // a bye's award, a drop's concession — are deleted with the pairing, but
  // an entered result (a forfeit or no-show included) refuses the break.
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
            <DropdownMenuItem
              disabled={isBye}
              onSelect={() => setRecordingNoShow(true)}
            >
              <UserX />
              Record no-show
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={isBye}
              onSelect={() => setRecordingForfeit(true)}
            >
              <Flag />
              Record forfeit
            </DropdownMenuItem>
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
      {recordingNoShow ? (
        <RecordNoShowDialog
          row={row}
          // Draws are refused exactly where the phase is a bracket.
          isBracket={!allowDraws}
          open={recordingNoShow}
          onOpenChange={setRecordingNoShow}
        />
      ) : null}
      {recordingForfeit ? (
        <RecordForfeitDialog
          row={row}
          open={recordingForfeit}
          onOpenChange={setRecordingForfeit}
        />
      ) : null}
    </>
  )
}
