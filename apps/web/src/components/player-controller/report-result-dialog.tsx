import { useState } from 'react'
import { formatGameScoreline, useReportResult } from '@paper-pairings/core'
import {
  MAX_GAME_DRAWS,
  requiredGameWins,
} from '@paper-pairings/shared/match-structure'
import { Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'

import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { BestOf } from '@paper-pairings/shared/match-structure'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

export function ReportResultDialog({
  matchId,
  bestOf,
  opponentName,
  open,
  onOpenChange,
}: {
  matchId: Id<'tournamentMatches'>
  bestOf: BestOf
  opponentName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const maxGameWins = requiredGameWins(bestOf)
  const reportResult = useReportResult()
  const { busy, run } = useBusyAction()
  const [myGameWins, setMyGameWins] = useState(0)
  const [opponentGameWins, setOpponentGameWins] = useState(0)
  const [gameDraws, setGameDraws] = useState(0)

  async function handleSubmit() {
    await run(async () => {
      await reportResult({ matchId, myGameWins, opponentGameWins, gameDraws })
      onOpenChange(false)
      toast.success('Result reported.')
    }, 'Could not report the result.')
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
          <DialogTitle>Report match result</DialogTitle>
          <DialogDescription>
            Enter the games each player won. The result counts immediately; your
            organizer can correct it if something is wrong.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <GameWinsStepper
            label="You"
            value={myGameWins}
            max={maxGameWins}
            onChange={setMyGameWins}
            disabled={busy}
          />
          <GameWinsStepper
            label={opponentName}
            value={opponentGameWins}
            max={maxGameWins}
            onChange={setOpponentGameWins}
            disabled={busy}
          />
          <GameWinsStepper
            label="Drawn games"
            value={gameDraws}
            max={MAX_GAME_DRAWS}
            onChange={setGameDraws}
            disabled={busy}
          />
          <p className="text-center text-sm font-medium text-muted-foreground">
            {resultPreview(
              myGameWins,
              opponentGameWins,
              gameDraws,
              opponentName,
            )}
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            disabled={busy}
            onClick={() => void handleSubmit()}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Submit result
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GameWinsStepper({
  label,
  value,
  max,
  onChange,
  disabled,
}: {
  label: string
  value: number
  max: number
  onChange: (value: number) => void
  disabled: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <p className="min-w-0 truncate text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Fewer game wins for ${label}`}
          disabled={disabled || value <= 0}
          onClick={() => onChange(value - 1)}
        >
          <Minus />
        </Button>
        <span className="w-6 text-center text-lg font-semibold tabular-nums">
          {value}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`More game wins for ${label}`}
          disabled={disabled || value >= max}
          onClick={() => onChange(value + 1)}
        >
          <Plus />
        </Button>
      </div>
    </div>
  )
}

function resultPreview(
  myGameWins: number,
  opponentGameWins: number,
  gameDraws: number,
  opponentName: string,
) {
  if (myGameWins > opponentGameWins) {
    return `You win ${formatGameScoreline(myGameWins, opponentGameWins, gameDraws)}`
  }
  if (myGameWins < opponentGameWins) {
    return `${opponentName} wins ${formatGameScoreline(opponentGameWins, myGameWins, gameDraws)}`
  }
  return `Draw ${formatGameScoreline(myGameWins, opponentGameWins, gameDraws)}`
}
