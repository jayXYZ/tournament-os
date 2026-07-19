import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { pairedPlayerName } from './pairing-row'
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

export function EnterResultDialog({
  row,
  open,
  onOpenChange,
}: {
  row: PairingRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const recordMatchResult = useMutation(
    api.tournaments.rounds.recordMatchResult,
  )
  const playerOne = row.players.at(0)
  const playerTwo = row.players.at(1)

  const [busy, setBusy] = useState(false)
  const [playerOneWins, setPlayerOneWins] = useState(
    String(playerOne?.gameWins ?? 0),
  )
  const [playerTwoWins, setPlayerTwoWins] = useState(
    String(playerTwo?.gameWins ?? 0),
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!playerOne || !playerTwo) {
      return
    }

    setBusy(true)
    try {
      await recordMatchResult({
        matchId: row.match._id,
        playerOneRegistrationId: playerOne.playerId,
        playerTwoRegistrationId: playerTwo.playerId,
        playerOneGameWins: Number.parseInt(playerOneWins, 10),
        playerTwoGameWins: Number.parseInt(playerTwoWins, 10),
      })
      onOpenChange(false)
      toast.success('Match result recorded.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not record the match result.',
      )
    } finally {
      setBusy(false)
    }
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
            <DialogTitle>Enter match result</DialogTitle>
            <DialogDescription>
              Record the game wins for each player
              {row.match.tableNumber === undefined
                ? ''
                : ` at table ${row.match.tableNumber}`}
              .
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`player-one-wins-${row.match._id}`}>
                  {pairedPlayerName(playerOne)}
                </FieldLabel>
                <Input
                  id={`player-one-wins-${row.match._id}`}
                  value={playerOneWins}
                  onChange={(event) => setPlayerOneWins(event.target.value)}
                  type="number"
                  min={0}
                  max={2}
                  disabled={busy}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`player-two-wins-${row.match._id}`}>
                  {pairedPlayerName(playerTwo)}
                </FieldLabel>
                <Input
                  id={`player-two-wins-${row.match._id}`}
                  value={playerTwoWins}
                  onChange={(event) => setPlayerTwoWins(event.target.value)}
                  type="number"
                  min={0}
                  max={2}
                  disabled={busy}
                  required
                />
              </Field>
            </div>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Save result
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
