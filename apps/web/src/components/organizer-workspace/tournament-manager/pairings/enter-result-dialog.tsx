import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { displayPlayerName } from '@paper-pairings/core'
import {
  MAX_GAME_DRAWS,
  gameWinsEntryError,
  matchDrawError,
  requiredGameWins,
} from '@paper-pairings/shared/match-structure'
import type { BestOf } from '@paper-pairings/shared/match-structure'
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

export function EnterResultDialog({
  row,
  bestOf,
  allowDraws,
  open,
  onOpenChange,
}: {
  row: PairingRow
  bestOf: BestOf
  /** Whether equal game wins is a legal result in this phase. */
  allowDraws: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const recordMatchResult = useMutation(
    api.tournaments.rounds.recordMatchResult,
  )
  const playerOne = row.players.at(0)
  const playerTwo = row.players.at(1)

  const { busy, run } = useBusyAction()
  const [playerOneWins, setPlayerOneWins] = useState(
    String(playerOne?.gameWins ?? 0),
  )
  const [playerTwoWins, setPlayerTwoWins] = useState(
    String(playerTwo?.gameWins ?? 0),
  )
  const [gameDraws, setGameDraws] = useState(String(playerOne?.gameDraws ?? 0))
  const [note, setNote] = useState('')
  // Each field carries only its own fixed bounds (whole numbers from 0 to
  // the wins that take the match), so the browser flags just the field the
  // organizer typed in. The rules that span both fields — a scoreline the
  // backend would reject (2–2 in a best-of-3), or equal counts where the
  // phase forbids a draw — are checked with the shared helpers and shown as
  // a message instead, so the save waits for a valid scoreline and says why.
  // `Number` rather than `parseInt` so a fractional entry reaches the
  // whole-number check instead of being silently truncated.
  const maxWins = requiredGameWins(bestOf)
  const playerOneGameWins = Number(playerOneWins)
  const playerTwoGameWins = Number(playerTwoWins)
  const entryError =
    gameWinsEntryError(
      bestOf,
      playerOneGameWins,
      playerTwoGameWins,
      Number(gameDraws || 0),
    ) ?? matchDrawError(allowDraws, playerOneGameWins, playerTwoGameWins)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!playerOne || !playerTwo) {
      return
    }

    await run(async () => {
      await recordMatchResult({
        matchId: row.match._id,
        playerOneRegistrationId: playerOne.playerId,
        playerTwoRegistrationId: playerTwo.playerId,
        playerOneGameWins,
        playerTwoGameWins,
        gameDraws: Number(gameDraws || 0),
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      })
      onOpenChange(false)
      toast.success('Match result recorded.')
    }, 'Could not record the match result.')
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
                  {displayPlayerName(playerOne?.playerName)}
                </FieldLabel>
                <Input
                  id={`player-one-wins-${row.match._id}`}
                  value={playerOneWins}
                  onChange={(event) => setPlayerOneWins(event.target.value)}
                  type="number"
                  min={0}
                  max={maxWins}
                  step={1}
                  disabled={busy}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`player-two-wins-${row.match._id}`}>
                  {displayPlayerName(playerTwo?.playerName)}
                </FieldLabel>
                <Input
                  id={`player-two-wins-${row.match._id}`}
                  value={playerTwoWins}
                  onChange={(event) => setPlayerTwoWins(event.target.value)}
                  type="number"
                  min={0}
                  max={maxWins}
                  step={1}
                  disabled={busy}
                  required
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`game-draws-${row.match._id}`}>
                  Drawn games
                </FieldLabel>
                <Input
                  id={`game-draws-${row.match._id}`}
                  value={gameDraws}
                  onChange={(event) => setGameDraws(event.target.value)}
                  type="number"
                  min={0}
                  max={MAX_GAME_DRAWS}
                  step={1}
                  disabled={busy}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`result-note-${row.match._id}`}>
                  Note (optional)
                </FieldLabel>
                <Input
                  id={`result-note-${row.match._id}`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Why this correction?"
                  maxLength={500}
                  disabled={busy}
                />
              </Field>
            </div>
          </FieldGroup>

          {entryError ? (
            <p role="status" className="text-sm text-muted-foreground">
              {entryError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="submit" disabled={busy || entryError !== null}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Save result
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
