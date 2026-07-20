import { useState } from 'react'
import { useMutation } from 'convex/react'
import { FlaskConical, RotateCcw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

export type PairingsBoard = FunctionReturnType<
  typeof api.tournaments.rounds.getPairingsBoard
>

export function PairingsSettingsMenu({
  board,
  roundId,
  onRewound,
}: {
  board: PairingsBoard | undefined
  roundId: Id<'tournamentRounds'> | null
  onRewound: () => void
}) {
  const generateTestRoundResults = useMutation(
    api.tournaments.testing.generateTestRoundResults,
  )
  const { busy, run } = useBusyAction()
  const [confirmingRewind, setConfirmingRewind] = useState(false)
  const rewindLatestRound = useMutation(
    api.tournaments.rounds.rewindLatestRound,
  )

  const canSimulate =
    board !== undefined && board.tournament.isTestEvent && roundId !== null

  async function handleSimulateResults() {
    if (!board || !roundId) {
      return
    }

    await run(async () => {
      await generateTestRoundResults({
        tournamentId: board.tournament._id,
        roundId,
      })
      toast.success('Match results simulated.')
    }, 'Could not simulate match results.')
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Pairings settings"
          >
            {busy ? <Spinner /> : <Settings2 />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={!canSimulate || busy}
              onSelect={() => void handleSimulateResults()}
            >
              <FlaskConical />
              Simulate Match Results
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!board?.rewind.eligible || busy}
              title={board?.rewind.reason ?? undefined}
              variant="destructive"
              onSelect={() => setConfirmingRewind(true)}
            >
              <RotateCcw />
              Unpublish pairings and rewind
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmActionDialog
        open={confirmingRewind}
        onOpenChange={setConfirmingRewind}
        icon={<RotateCcw />}
        destructive
        title={`Unpublish round ${board?.rewind.removedRoundNumber} pairings?`}
        description={
          <>
            {board?.rewind.reopenedRoundNumber === null
              ? 'These pairings will be permanently removed and registration will reopen.'
              : `These pairings will be permanently removed so you can correct round ${board?.rewind.reopenedRoundNumber} and recalculate its standings.`}{' '}
            The round timer will stop. Tell players that updated pairings are
            coming before generating them again.
          </>
        }
        cancelLabel="Keep pairings"
        actionLabel="Unpublish and rewind"
        failureMessage="Could not unpublish pairings."
        onConfirm={async () => {
          if (!board) {
            throw new Error('Pairings are no longer available.')
          }
          if (!board.rewind.eligible) {
            throw new Error(
              board.rewind.reason ??
                'These pairings can no longer be unpublished.',
            )
          }
          await rewindLatestRound({ tournamentId: board.tournament._id })
          onRewound()
          toast.success(
            board.rewind.reopenedRoundNumber === null
              ? 'Pairings unpublished. Registration is open again.'
              : `Pairings unpublished. Round ${board.rewind.reopenedRoundNumber} reopened.`,
          )
        }}
      />
    </>
  )
}
