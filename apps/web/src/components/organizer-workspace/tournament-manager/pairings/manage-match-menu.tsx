import { useState } from 'react'
import { useMutation } from 'convex/react'
import { ClipboardPen, MoreHorizontal, Unlink } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { mutationErrorMessage } from '@tournament-os/core'
import { EnterResultDialog } from './enter-result-dialog'
import type { BestOf } from '@tournament-os/shared/match-structure'
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
  canEditPairings,
}: {
  row: PairingRow
  bestOf: BestOf
  canEditPairings: boolean
}) {
  const isBye = row.players.some((player) => player.isBye)
  const [enteringResult, setEnteringResult] = useState(false)
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
          open={enteringResult}
          onOpenChange={setEnteringResult}
        />
      ) : null}
    </>
  )
}
