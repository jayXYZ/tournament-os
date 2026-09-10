import { Link } from '@tanstack/react-router'
import { useRoundTimer } from '@paper-pairings/core'
import {
  DEFAULT_ROUND_DURATION_MS,
  formatTimer,
} from '@paper-pairings/shared/timer-utils'

import { describeNextStep } from './next-step'
import { inProgressRound } from './pairings-board'
import { phaseLabel } from './phase-label'
import { activeRoundTimer } from './round-timer-chip'
import type { ReactNode } from 'react'
import type { PairingsBoard } from './pairings-board'
import { cn } from '@/lib/utils'

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

// The one place on the overview that says where the tournament is: the
// round, the clock, how many results are in, and the single next action.
// Every figure here comes from the board, and the headline and hint from
// describeNextStep, so the band cannot disagree with the button it holds.
export function LiveStatusBand({
  board,
  publicCode,
  action,
}: {
  board: PairingsBoard
  publicCode: string
  action: ReactNode
}) {
  const description = describeNextStep(board)
  const { tournament, field, liveRound } = board
  const round = inProgressRound(board)
  const timer = useRoundTimer(activeRoundTimer(board))
  const overtime = timer.phase !== 'idle' && timer.remainingMs < 0

  const cells: Array<ReactNode> = []

  const roundInPlay =
    description.body === 'live' || description.body === 'unpublished-pairings'

  if (roundInPlay && round) {
    const phaseIndex = board.phases.findIndex(
      (phaseBoard) => phaseBoard.phase._id === round.tournamentPhaseId,
    )
    const phaseBoard = board.phases[phaseIndex]
    const start = phaseBoard.timeline.startRoundNumber ?? round.roundNumber
    const planned = phaseBoard.timeline.plannedRoundCount
    const label = phaseLabel(
      phaseBoard.phase,
      phaseIndex > 0 ? board.phases[phaseIndex - 1].phase : undefined,
    )
    cells.push(
      <BandCell key="round" label="Round">
        <BandFigure
          value={String(round.roundNumber - start + 1)}
          unit={planned === null ? undefined : `of ${planned}`}
        />
        <BandNote>
          {label}
          {round.pairingsPublishedAt === undefined
            ? ', pairings not yet published'
            : `, pairings published ${timeFormatter.format(new Date(round.pairingsPublishedAt))}`}
        </BandNote>
      </BandCell>,
    )
  } else {
    cells.push(
      <BandCell key="status" label="Status">
        <p className="text-2xl font-semibold tracking-tight text-balance">
          {description.headline}
        </p>
      </BandCell>,
    )
  }

  if (roundInPlay && tournament.lifecycle === 'in_progress') {
    cells.push(
      <BandCell key="time" label="Time left">
        <Link
          to="/admin/tournaments/$tournamentId/timer"
          params={{ tournamentId: publicCode }}
          className="group -m-1 block rounded-md p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={
            timer.phase === 'idle'
              ? 'Round timer not started: open timer controls'
              : `Round timer ${timer.formatted}: open timer controls`
          }
        >
          {timer.phase === 'idle' ? (
            <BandFigure value="Not started" small />
          ) : (
            <BandFigure
              value={timer.formatted}
              className={cn(overtime && 'text-destructive')}
            />
          )}
          <BandNote className="group-hover:text-foreground">
            {timer.phase === 'idle'
              ? `${formatTimer(tournament.roundDurationMs ?? DEFAULT_ROUND_DURATION_MS)} round. Start it in Timer.`
              : timer.phase === 'paused'
                ? 'Paused. Resume or extend in Timer.'
                : overtime
                  ? 'Time is up. Extend or clear in Timer.'
                  : 'Pause or extend in Timer.'}
          </BandNote>
        </Link>
      </BandCell>,
    )
  }

  if (liveRound) {
    const outstanding = liveRound.tableCount - liveRound.resultsIn
    const complete = outstanding === 0 && liveRound.tableCount > 0
    const attention = overtime && outstanding > 0
    const notes: Array<string> = []
    if (outstanding > 0) {
      notes.push(
        `${outstanding} ${outstanding === 1 ? 'table' : 'tables'} still playing`,
      )
    }
    if (liveRound.byeCount > 0) {
      notes.push(
        `${liveRound.byeCount} ${liveRound.byeCount === 1 ? 'bye' : 'byes'} awarded`,
      )
    }
    if (liveRound.unconfirmedCount > 0) {
      notes.push(
        `${liveRound.unconfirmedCount} ${liveRound.unconfirmedCount === 1 ? 'result' : 'results'} unconfirmed`,
      )
    }
    cells.push(
      <BandCell key="results" label="Results in" className="lg:flex-[1.5]">
        <BandFigure
          value={String(liveRound.resultsIn)}
          unit={`of ${liveRound.tableCount}`}
        />
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={liveRound.tableCount}
          aria-valuenow={liveRound.resultsIn}
          aria-label="Results received"
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none',
              attention
                ? 'bg-round-pairings'
                : complete
                  ? 'bg-accent-brand'
                  : 'bg-round-live',
            )}
            style={{
              width: `${liveRound.tableCount === 0 ? 0 : (liveRound.resultsIn / liveRound.tableCount) * 100}%`,
            }}
          />
        </div>
        <BandNote className={cn(attention && 'text-round-pairings')}>
          {complete
            ? 'All tables reported.'
            : attention
              ? `Time is up. ${notes.join(', ')}.`
              : `${notes.join(', ')}.`}
        </BandNote>
      </BandCell>,
    )
  } else {
    cells.push(
      <BandCell key="players" label="Players">
        <BandFigure
          value={String(
            tournament.lifecycle === 'in_progress'
              ? field.active
              : field.confirmed,
          )}
          unit={
            tournament.lifecycle === 'in_progress'
              ? 'playing'
              : `of ${tournament.playerCapacity}`
          }
        />
        <BandNote>
          {tournament.lifecycle === 'in_progress'
            ? describeDepartures(field)
            : `${field.confirmed} ${field.confirmed === 1 ? 'player' : 'players'} registered`}
        </BandNote>
      </BandCell>,
    )
  }

  return (
    <section
      aria-label="Live status"
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card lg:flex-row"
    >
      {cells}
      <div className="flex flex-col items-start gap-2 bg-background p-4 lg:min-w-64 lg:items-end lg:justify-center">
        {action}
        {description.hint ? (
          <p className="max-w-64 text-xs text-muted-foreground lg:text-right">
            {description.hint}
          </p>
        ) : null}
      </div>
    </section>
  )
}

function describeDepartures(field: PairingsBoard['field']) {
  const parts: Array<string> = []
  if (field.dropped > 0) {
    parts.push(`${field.dropped} dropped`)
  }
  if (field.eliminated > 0) {
    parts.push(`${field.eliminated} eliminated`)
  }
  if (field.disqualified > 0) {
    parts.push(`${field.disqualified} disqualified`)
  }
  return parts.length === 0
    ? `All ${field.confirmed} registered players are still in.`
    : `${parts.join(', ')} of ${field.confirmed} registered.`
}

function BandCell({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col gap-1 border-b border-border p-4 lg:border-b-0 lg:border-r',
        className,
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}

function BandFigure({
  value,
  unit,
  small = false,
  className,
}: {
  value: string
  unit?: string
  small?: boolean
  className?: string
}) {
  return (
    <p
      className={cn(
        'font-semibold tracking-tight tabular-nums',
        small ? 'text-2xl' : 'text-3xl',
        className,
      )}
    >
      {value}
      {unit ? (
        <span className="ml-1.5 text-sm font-medium tracking-normal text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </p>
  )
}

function BandNote({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <p className={cn('mt-1 text-xs text-muted-foreground', className)}>
      {children}
    </p>
  )
}
