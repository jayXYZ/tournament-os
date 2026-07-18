import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Minus, Pause, Play, Plus } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import {
  DEFAULT_ROUND_DURATION_MS,
  MAX_ROUND_DURATION_MS,
  MIN_ROUND_DURATION_MS,
  durationMsToMinutes,
  formatTimer,
  minutesToDurationMs,
} from '@tournament-os/shared/timer-utils'
import { useRoundTimer } from '@tournament-os/core'

import { activeRoundTimer } from './round-timer-chip'
import type { FormEvent } from 'react'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { HoldButton } from '@/components/ui/hold-button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

type PairingsBoard = FunctionReturnType<
  typeof api.tournaments.rounds.getPairingsBoard
>

const MIN_MINUTES = durationMsToMinutes(MIN_ROUND_DURATION_MS)
const MAX_MINUTES = durationMsToMinutes(MAX_ROUND_DURATION_MS)

export function RoundTimerView({ tournamentId }: { tournamentId: string }) {
  const board = useQuery(api.tournaments.rounds.getPairingsBoard, {
    tournamentId: tournamentId as Id<'tournaments'>,
  })

  return (
    <section className="flex flex-col gap-4">
      {board === undefined ? (
        <div className="grid gap-4">
          <Skeleton className="h-80" />
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <TimerCard key={board.tournament._id} board={board} />
          <RoundLengthCard
            key={`${board.tournament._id}-length`}
            tournament={board.tournament}
          />
        </>
      )}
    </section>
  )
}

function TimerCard({ board }: { board: PairingsBoard }) {
  const startTimer = useMutation(api.tournaments.timer.startTimer)
  const pauseTimer = useMutation(api.tournaments.timer.pauseTimer)
  const resumeTimer = useMutation(api.tournaments.timer.resumeTimer)
  const adjustTimer = useMutation(api.tournaments.timer.adjustTimer)
  const clearTimer = useMutation(api.tournaments.timer.clearTimer)

  const tournamentId = board.tournament._id
  const currentRound =
    board.phases
      .flatMap((phaseBoard) => phaseBoard.rounds)
      .find((round) => round.roundStatus === 'in_progress') ?? null
  const pairingsPublished = currentRound?.pairingsPublishedAt !== undefined
  const timer = activeRoundTimer(board)
  const { phase, remainingMs, formatted } = useRoundTimer(timer)
  const overtime = remainingMs < 0

  const savedMinutes = String(
    durationMsToMinutes(
      board.tournament.roundDurationMs ?? DEFAULT_ROUND_DURATION_MS,
    ),
  )
  const [draftMinutes, setDraftMinutes] = useState(savedMinutes)
  // Re-sync the draft when the saved default changes (e.g. via RoundLengthCard).
  const [prevSavedMinutes, setPrevSavedMinutes] = useState(savedMinutes)
  if (savedMinutes !== prevSavedMinutes) {
    setPrevSavedMinutes(savedMinutes)
    setDraftMinutes(savedMinutes)
  }
  const [busy, setBusy] = useState(false)
  const parsedMinutes = Number.parseInt(draftMinutes, 10)
  const minutesValid =
    Number.isInteger(parsedMinutes) &&
    parsedMinutes >= MIN_MINUTES &&
    parsedMinutes <= MAX_MINUTES

  async function run(action: () => Promise<unknown>, failure: string) {
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : failure)
    } finally {
      setBusy(false)
    }
  }

  // Rethrow so HoldButton skips its success state on failure (see hold-button).
  async function handleReset() {
    try {
      await clearTimer({ tournamentId })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not reset the timer.',
      )
      throw error
    }
  }

  const disabled = currentRound === null || !pairingsPublished || busy

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {currentRound ? currentRound.roundName : 'No round in progress'}
        </CardTitle>
        <CardDescription>
          Everyone viewing the event page or player controller sees this timer
          live.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-6 py-6">
        <div className="flex flex-col items-center gap-1">
          <p
            aria-live="off"
            className={cn(
              'text-6xl font-semibold tabular-nums tracking-tight sm:text-7xl',
              phase === 'idle' && 'text-muted-foreground/50',
              overtime && 'text-destructive',
            )}
          >
            {phase === 'idle'
              ? formatTimer(
                  minutesToDurationMs(minutesValid ? parsedMinutes : 0),
                )
              : formatted}
          </p>
          <p className="text-sm text-muted-foreground">
            {phase === 'idle'
              ? currentRound
                ? pairingsPublished
                  ? 'Timer not started'
                  : 'Publish pairings to make the timer available.'
                : 'The timer becomes available while a round is in progress.'
              : phase === 'paused'
                ? overtime
                  ? 'Paused in overtime'
                  : 'Paused'
                : overtime
                  ? 'Time in round'
                  : timer
                    ? `of a ${formatTimer(timer.durationMs)} round`
                    : ''}
          </p>
        </div>

        {phase === 'idle' ? (
          <div className="flex items-end gap-2">
            <Field className="w-24">
              <FieldLabel htmlFor="timer-minutes">Minutes</FieldLabel>
              <Input
                id="timer-minutes"
                type="number"
                inputMode="numeric"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                value={draftMinutes}
                onChange={(event) => setDraftMinutes(event.target.value)}
                disabled={disabled}
              />
            </Field>
            <Button
              type="button"
              disabled={disabled || !minutesValid}
              onClick={() =>
                void run(
                  () =>
                    startTimer({
                      tournamentId,
                      durationMs: minutesToDurationMs(parsedMinutes),
                    }),
                  'Could not start the timer.',
                )
              }
            >
              <Play />
              Start
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {phase === 'paused' ? (
              <Button
                type="button"
                disabled={disabled}
                onClick={() =>
                  void run(
                    () => resumeTimer({ tournamentId }),
                    'Could not resume the timer.',
                  )
                }
              >
                <Play />
                Resume
              </Button>
            ) : (
              <Button
                type="button"
                disabled={disabled}
                onClick={() =>
                  void run(
                    () => pauseTimer({ tournamentId }),
                    'Could not pause the timer.',
                  )
                }
              >
                <Pause />
                Pause
              </Button>
            )}
            <AdjustButton
              deltaMinutes={-1}
              disabled={disabled}
              onAdjust={(deltaMs) =>
                run(
                  () => adjustTimer({ tournamentId, deltaMs }),
                  'Could not adjust the timer.',
                )
              }
            />
            <AdjustButton
              deltaMinutes={1}
              disabled={disabled}
              onAdjust={(deltaMs) =>
                run(
                  () => adjustTimer({ tournamentId, deltaMs }),
                  'Could not adjust the timer.',
                )
              }
            />
            <AdjustButton
              deltaMinutes={5}
              disabled={disabled}
              onAdjust={(deltaMs) =>
                run(
                  () => adjustTimer({ tournamentId, deltaMs }),
                  'Could not adjust the timer.',
                )
              }
            />
            <HoldButton
              variant="destructive"
              disabled={disabled}
              onConfirm={handleReset}
              successLabel="Timer reset"
            >
              Hold to reset
            </HoldButton>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function AdjustButton({
  deltaMinutes,
  disabled,
  onAdjust,
}: {
  deltaMinutes: number
  disabled: boolean
  onAdjust: (deltaMs: number) => Promise<void>
}) {
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      onClick={() => void onAdjust(minutesToDurationMs(deltaMinutes))}
    >
      {deltaMinutes < 0 ? <Minus /> : <Plus />}
      {Math.abs(deltaMinutes)} min
    </Button>
  )
}

function RoundLengthCard({
  tournament,
}: {
  tournament: PairingsBoard['tournament']
}) {
  const setRoundDuration = useMutation(api.tournaments.timer.setRoundDuration)
  const [minutes, setMinutes] = useState(
    String(
      durationMsToMinutes(tournament.roundDurationMs ?? DEFAULT_ROUND_DURATION_MS),
    ),
  )
  const [busy, setBusy] = useState(false)
  const parsed = Number.parseInt(minutes, 10)
  const valid =
    Number.isInteger(parsed) && parsed >= MIN_MINUTES && parsed <= MAX_MINUTES

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    try {
      await setRoundDuration({
        tournamentId: tournament._id,
        durationMs: minutesToDurationMs(parsed),
      })
      toast.success('Round length saved.')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not save round length.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Round length</CardTitle>
        <CardDescription>
          Pre-fills the timer when you start a round.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex items-end gap-2">
          <Field className="w-24">
            <FieldLabel htmlFor="round-length-minutes">Minutes</FieldLabel>
            <Input
              id="round-length-minutes"
              type="number"
              inputMode="numeric"
              min={MIN_MINUTES}
              max={MAX_MINUTES}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              disabled={busy}
            />
          </Field>
          <Button type="submit" variant="outline" disabled={busy || !valid}>
            Save
          </Button>
        </form>
        <FieldDescription className="mt-2">
          Between {MIN_MINUTES} minutes and {MAX_MINUTES / 60} hours.
        </FieldDescription>
      </CardContent>
    </Card>
  )
}
