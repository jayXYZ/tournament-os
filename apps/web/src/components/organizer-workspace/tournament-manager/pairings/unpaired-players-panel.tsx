import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { displayPlayerName } from '@tournament-os/core'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

type UnpairedPlayer = FunctionReturnType<
  typeof api.tournaments.rounds.listUnpairedPlayers
>[number]

// The players freed by broken pairings (or left unpaired by a mid-round
// reinstatement). Pairings cannot be published while this list is non-empty,
// so it doubles as the organizer's work queue: each row offers the manual
// re-pair — another unpaired player, or a bye.
export function UnpairedPlayersPanel({
  roundId,
}: {
  roundId: Id<'tournamentRounds'>
}) {
  const unpaired = useQuery(api.tournaments.rounds.listUnpairedPlayers, {
    roundId,
  })
  const [pairingFor, setPairingFor] = useState<UnpairedPlayer | null>(null)

  if (!unpaired || unpaired.length === 0) {
    return null
  }

  return (
    <div className="rounded-lg border border-round-pairings/40 bg-round-pairings/5 p-4">
      <div className="flex items-center gap-2">
        <UserPlus className="size-4 text-round-pairings" />
        <p className="text-sm font-medium">
          {unpaired.length === 1
            ? '1 player needs an opponent or a bye'
            : `${unpaired.length} players need an opponent or a bye`}
        </p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Pairings cannot be published to players until everyone below is paired.
      </p>
      <ul className="mt-3 divide-y">
        {unpaired.map((player) => (
          <li
            key={player.registrationId}
            className="flex items-center justify-between gap-3 py-2"
          >
            <span className="text-sm font-medium">
              {displayPlayerName(player.playerName)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPairingFor(player)}
            >
              Pair player
            </Button>
          </li>
        ))}
      </ul>

      {pairingFor ? (
        <PairPlayerDialog
          roundId={roundId}
          player={pairingFor}
          candidates={unpaired.filter(
            (candidate) =>
              candidate.registrationId !== pairingFor.registrationId,
          )}
          open
          onOpenChange={(open) => {
            if (!open) {
              setPairingFor(null)
            }
          }}
        />
      ) : null}
    </div>
  )
}

// Sentinel for the bye choice in the opponent select; registration ids are
// Convex ids and can never collide with it.
const BYE_OPTION = 'bye'

function PairPlayerDialog({
  roundId,
  player,
  candidates,
  open,
  onOpenChange,
}: {
  roundId: Id<'tournamentRounds'>
  player: UnpairedPlayer
  candidates: Array<UnpairedPlayer>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const pairPlayers = useMutation(api.tournaments.rounds.pairPlayers)
  const assignBye = useMutation(api.tournaments.rounds.assignBye)
  const { busy, run } = useBusyAction()
  const [selection, setSelection] = useState<string>(
    candidates.length > 0 ? candidates[0].registrationId : BYE_OPTION,
  )

  const playerName = displayPlayerName(player.playerName)

  async function handleConfirm() {
    await run(async () => {
      if (selection === BYE_OPTION) {
        await assignBye({ roundId, registrationId: player.registrationId })
        toast.success(`${playerName} was awarded a bye.`)
      } else {
        await pairPlayers({
          roundId,
          playerOneRegistrationId: player.registrationId,
          playerTwoRegistrationId: selection as Id<'tournamentRegistrations'>,
        })
        toast.success(`${playerName} was paired.`)
      }
      onOpenChange(false)
    }, 'Could not pair the player.')
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
        <DialogHeader>
          <DialogTitle>Pair {playerName}</DialogTitle>
          <DialogDescription>
            Choose an opponent from the players without one, or award a bye (a
            free match win).
          </DialogDescription>
        </DialogHeader>

        <Field>
          <FieldLabel htmlFor={`pair-opponent-${player.registrationId}`}>
            Opponent
          </FieldLabel>
          <Select
            value={selection}
            onValueChange={setSelection}
            disabled={busy}
          >
            <SelectTrigger
              id={`pair-opponent-${player.registrationId}`}
              className="w-full"
            >
              <SelectValue placeholder="Choose an opponent" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((candidate) => (
                <SelectItem
                  key={candidate.registrationId}
                  value={candidate.registrationId}
                >
                  {displayPlayerName(candidate.playerName)}
                </SelectItem>
              ))}
              <SelectItem value={BYE_OPTION}>
                Award a bye (no opponent)
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <DialogFooter>
          <Button type="button" onClick={handleConfirm} disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : null}
            {selection === BYE_OPTION ? 'Award bye' : 'Pair players'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
