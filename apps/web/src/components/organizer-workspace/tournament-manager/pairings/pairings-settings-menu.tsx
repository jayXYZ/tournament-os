import { useState } from 'react'
import { useMutation } from 'convex/react'
import { FlaskConical, RotateCcw, Settings2 } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'

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
  const [busy, setBusy] = useState(false)
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

    setBusy(true)
    try {
      await generateTestRoundResults({
        tournamentId: board.tournament._id,
        roundId,
      })
      toast.success('Match results simulated.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not simulate match results.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleRewind() {
    if (!board?.rewind.eligible) {
      return
    }
    setBusy(true)
    try {
      await rewindLatestRound({ tournamentId: board.tournament._id })
      setConfirmingRewind(false)
      onRewound()
      toast.success(
        board.rewind.reopenedRoundNumber === null
          ? 'Pairings unpublished. Registration is open again.'
          : `Pairings unpublished. Round ${board.rewind.reopenedRoundNumber} reopened.`,
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not unpublish pairings.',
      )
    } finally {
      setBusy(false)
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

      <AlertDialog
        open={confirmingRewind}
        onOpenChange={(open) => {
          if (!busy) {
            setConfirmingRewind(open)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="text-destructive">
              <RotateCcw />
            </AlertDialogMedia>
            <AlertDialogTitle>
              Unpublish round {board?.rewind.removedRoundNumber} pairings?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {board?.rewind.reopenedRoundNumber === null
                ? 'These pairings will be permanently removed and registration will reopen.'
                : `These pairings will be permanently removed so you can correct round ${board?.rewind.reopenedRoundNumber} and recalculate its standings.`}{' '}
              The round timer will stop. Tell players that updated pairings are
              coming before generating them again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep pairings</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void handleRewind()
              }}
            >
              {busy ? <Spinner data-icon="inline-start" /> : <RotateCcw />}
              Unpublish and rewind
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
