import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { ListOrdered, Swords, TimerIcon, Trophy } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { RoundTimerChip } from './round-timer-chip'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { HoldButton } from '@/components/ui/hold-button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type PairingsBoard = FunctionReturnType<
  typeof api.tournaments.rounds.getPairingsBoard
>
type PhaseBoard = PairingsBoard['phases'][number]
type Round = PhaseBoard['rounds'][number]
type AdvanceStep = Exclude<
  PairingsBoard['nextStep'],
  { kind: 'tournamentCompleted' } | { kind: 'tournamentCancelled' }
>

// One node on the bar. Beyond the rounds that exist, fixed-length phases show
// their remaining planned rounds and dynamic phases show a single "?" node,
// so the bar's full width reflects the tournament's expected shape. A planned
// round's number is null when it can't be known yet (an earlier dynamic phase
// hasn't resolved its round count), in which case the node shows "?".
type RoundSlot =
  | { kind: 'round'; round: Round }
  | { kind: 'planned'; roundNumber: number | null }
  | { kind: 'unknown' }

// Round numbers are global across the tournament (a later phase continues the
// numbering), so planned nodes count on from the phase's start number.
function phaseSlots(
  phaseBoard: PhaseBoard,
  startNumber: number | null,
): Array<RoundSlot> {
  const { phase, rounds } = phaseBoard
  const slots: Array<RoundSlot> = rounds.map((round) => ({
    kind: 'round',
    round,
  }))

  if (phase.phaseTotalRounds !== null) {
    for (let index = rounds.length; index < phase.phaseTotalRounds; index++) {
      slots.push({
        kind: 'planned',
        roundNumber: startNumber === null ? null : startNumber + index,
      })
    }
  } else if (
    phase.phaseStatus === 'upcoming' ||
    phase.phaseStatus === 'in_progress'
  ) {
    slots.push({ kind: 'unknown' })
  }

  return slots
}

// Each phase's first global round number: taken from its real rounds when any
// exist, otherwise projected from the rounds expected before it. An unresolved
// dynamic phase contributes an unknown number of rounds, so phases after it
// have no start number (null) until it resolves — numbering them would show
// values that silently change later.
function phaseStartNumbers(phases: Array<PhaseBoard>): Array<number | null> {
  const startNumbers: Array<number | null> = []
  let nextRoundNumber: number | null = 1
  for (const phaseBoard of phases) {
    const { phase, rounds } = phaseBoard
    const startNumber: number | null =
      rounds.at(0)?.roundNumber ?? nextRoundNumber
    startNumbers.push(startNumber)
    // A finished phase's round count is final even if its planned total was
    // never resolved.
    const finished =
      phase.phaseStatus === 'completed' || phase.phaseStatus === 'cancelled'
    nextRoundNumber =
      startNumber === null || (phase.phaseTotalRounds === null && !finished)
        ? null
        : startNumber + Math.max(phase.phaseTotalRounds ?? 0, rounds.length)
  }
  return startNumbers
}

// The round the organizer is currently viewing, derived from the active
// route's search params. Only set when the URL carries an explicit selection
// (i.e. after clicking a bar node or a round tab), which is exactly when the
// highlight is meaningful.
type CurrentRound = {
  view: 'pairings' | 'standings'
  phase: number
  round: number
}

function useCurrentRound(): CurrentRound | null {
  const pathname = useLocation().pathname
  const search = useSearch({ strict: false })

  const view = pathname.endsWith('/pairings')
    ? 'pairings'
    : pathname.endsWith('/standings')
      ? 'standings'
      : null
  if (!view || search.phase === undefined || search.round === undefined) {
    return null
  }
  return { view, phase: search.phase, round: search.round }
}

// A segmented progress strip for the tournament manager: one node per round,
// grouped into labeled phase sections. Filled nodes are completed rounds and
// link to that round's standings; the ringed node is the in-progress round and
// links to its pairings. The strip also carries the tournament's single
// advance action (start / next round / standings / complete), so it renders
// as soon as the board loads — even before any rounds exist.
export function TournamentProgressBar({
  tournamentId,
  publicCode,
}: {
  tournamentId: Id<'tournaments'>
  publicCode: string
}) {
  const board = useQuery(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  })
  const currentRound = useCurrentRound()
  const navigate = useNavigate()

  // Keep the bar's shell (and the advance control's slot) visible while the
  // board loads so the layout doesn't jump when it resolves.
  if (!board) {
    return (
      <nav
        aria-label="Tournament progress"
        aria-busy
        className="shrink-0 border-b border-border bg-background"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="size-6 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-7 w-44" />
        </div>
      </nav>
    )
  }

  const startNumbers = phaseStartNumbers(board.phases)

  return (
    <TooltipProvider>
      <nav
        aria-label="Tournament progress"
        className="shrink-0 border-b border-border bg-background"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="-m-1 flex min-w-0 items-end gap-6 overflow-x-auto p-1">
            {board.phases.map((phaseBoard, index) => (
              <PhaseSection
                key={phaseBoard.phase._id}
                phaseBoard={phaseBoard}
                startNumber={startNumbers[index]}
                publicCode={publicCode}
                showLabel={board.phases.length > 1}
                currentRound={currentRound}
              />
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <RoundTimerChip board={board} publicCode={publicCode} />
            <AdvanceStepButton
              board={board}
              // Clearing the search params lets the pairings/standings views
              // fall back to the newly current phase and round.
              onAdvanced={() =>
                void navigate({ to: '.', search: {}, replace: true })
              }
            />
          </div>
        </div>
      </nav>
    </TooltipProvider>
  )
}

function AdvanceStepButton({
  board,
  onAdvanced,
}: {
  board: PairingsBoard
  onAdvanced: () => void
}) {
  const startTournament = useMutation(api.tournaments.rounds.startTournament)
  const startTimer = useMutation(api.tournaments.timer.startTimer)
  const generateNextRound = useMutation(
    api.tournaments.rounds.generateNextRound,
  )
  const completeRound = useMutation(api.tournaments.rounds.completeRound)
  const completeTournament = useMutation(
    api.tournaments.lifecycle.completeTournament,
  )

  const step = board.nextStep
  if (step.kind === 'tournamentCancelled') {
    return <Badge variant="destructive">Tournament cancelled</Badge>
  }
  if (step.kind === 'tournamentCompleted') {
    return (
      <Button type="button" disabled>
        <Trophy />
        Tournament complete
      </Button>
    )
  }

  const action = advanceAction(step, board.tournament._id, {
    startTournament,
    startTimer,
    generateNextRound,
    completeRound,
    completeTournament,
  })

  // The hold button confirms success on its own face; errors still toast.
  // Rethrow so the button skips its success state on failure.
  async function handleAdvance() {
    try {
      await action.run()
      // Starting the timer doesn't change which round is current, so keep
      // whatever round the organizer is viewing instead of resetting it.
      if (step.kind !== 'startTimer') {
        onAdvanced()
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not advance the tournament.',
      )
      throw error
    }
  }

  // While blocked, the button face carries the reason ("16 matches still
  // need a result") instead of a "Hold to ..." label it can't act on; the
  // action's icon stays as a hint of what the gate is holding back.
  return (
    <HoldButton
      disabled={!step.ready}
      onConfirm={handleAdvance}
      successLabel={action.success}
    >
      {action.icon}
      {step.ready ? action.label : (step.reason ?? action.label)}
    </HoldButton>
  )
}

function advanceAction(
  step: AdvanceStep,
  tournamentId: Id<'tournaments'>,
  mutations: {
    startTournament: (args: {
      tournamentId: Id<'tournaments'>
    }) => Promise<unknown>
    startTimer: (args: {
      tournamentId: Id<'tournaments'>
    }) => Promise<unknown>
    generateNextRound: (args: {
      tournamentId: Id<'tournaments'>
    }) => Promise<unknown>
    completeRound: (args: {
      roundId: Id<'tournamentRounds'>
    }) => Promise<unknown>
    completeTournament: (args: {
      tournamentId: Id<'tournaments'>
    }) => Promise<unknown>
  },
) {
  // Success copy is shown on the button itself while it is still sized for
  // the idle label, so keep it shorter than the matching "Hold to" label.
  switch (step.kind) {
    case 'startTournament':
      return {
        label: 'Hold to generate pairings',
        icon: <Swords />,
        success: 'Pairings generated',
        run: () => mutations.startTournament({ tournamentId }),
      }
    case 'startTimer':
      return {
        label: 'Hold to start round timer',
        icon: <TimerIcon />,
        success: 'Timer started',
        run: () => mutations.startTimer({ tournamentId }),
      }
    case 'generateStandings':
      return {
        label: 'Hold to generate standings',
        icon: <ListOrdered />,
        success: 'Standings generated',
        run: () => mutations.completeRound({ roundId: step.roundId }),
      }
    case 'generateNextRound':
      return {
        label: 'Hold to generate pairings',
        icon: <Swords />,
        success: 'Pairings generated',
        run: () => mutations.generateNextRound({ tournamentId }),
      }
    case 'completeTournament':
      return {
        label: 'Hold to complete tournament',
        icon: <Trophy />,
        success: 'Tournament completed',
        run: () => mutations.completeTournament({ tournamentId }),
      }
  }
}

function PhaseSection({
  phaseBoard,
  startNumber,
  publicCode,
  showLabel,
  currentRound,
}: {
  phaseBoard: PhaseBoard
  startNumber: number | null
  publicCode: string
  showLabel: boolean
  currentRound: CurrentRound | null
}) {
  const { phase } = phaseBoard
  const slots = phaseSlots(phaseBoard, startNumber)
  if (slots.length === 0) {
    return null
  }

  const phaseName = phase.phaseName ?? `Phase ${phase.phaseOrder}`

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      {showLabel ? (
        <span
          className={cn(
            'text-[10px] font-medium uppercase tracking-wider',
            phase.phaseStatus === 'in_progress' ||
              phase.phaseStatus === 'completed'
              ? 'text-muted-foreground'
              : 'text-muted-foreground/60',
          )}
        >
          {phaseName}
        </span>
      ) : null}
      <ol className="flex items-center">
        {slots.map((slot, index) => {
          const previous = index > 0 ? slots[index - 1] : undefined
          const filled =
            previous?.kind === 'round' &&
            previous.round.roundStatus === 'completed'
          return (
            <li
              key={slot.kind === 'round' ? slot.round._id : `slot-${index}`}
              className="flex items-center"
            >
              {previous ? (
                <span
                  aria-hidden
                  className={cn(
                    'h-0.5 w-3 sm:w-5',
                    filled ? 'bg-primary' : 'bg-border',
                  )}
                />
              ) : null}
              <RoundNode
                slot={slot}
                phaseOrder={phase.phaseOrder}
                phaseName={phaseName}
                publicCode={publicCode}
                currentRound={currentRound}
              />
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const nodeClassName =
  'flex size-6 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums'

function RoundNode({
  slot,
  phaseOrder,
  phaseName,
  publicCode,
  currentRound,
}: {
  slot: RoundSlot
  phaseOrder: number
  phaseName: string
  publicCode: string
  currentRound: CurrentRound | null
}) {
  if (slot.kind !== 'round') {
    if (slot.kind === 'unknown') {
      return (
        <InertNode label="?" tooltip={`${phaseName} · More rounds may follow`} />
      )
    }
    return (
      <InertNode
        label={slot.roundNumber === null ? '?' : String(slot.roundNumber)}
        tooltip={
          slot.roundNumber === null
            ? `${phaseName} · Not started`
            : `${phaseName} · Round ${slot.roundNumber} · Not started`
        }
      />
    )
  }

  const { round } = slot
  // Completed rounds jump to that round's standings; the in-progress round
  // jumps to its pairings. Anything else (upcoming, cancelled) isn't a
  // destination yet.
  const view =
    round.roundStatus === 'completed'
      ? 'standings'
      : round.roundStatus === 'in_progress'
        ? 'pairings'
        : null

  if (!view) {
    return (
      <InertNode
        label={String(round.roundNumber)}
        tooltip={`${phaseName} · ${round.roundName} · ${
          round.roundStatus === 'cancelled' ? 'Cancelled' : 'Not started'
        }`}
      />
    )
  }

  const completed = view === 'standings'
  const isCurrent =
    currentRound?.view === view &&
    currentRound.phase === phaseOrder &&
    currentRound.round === round.roundNumber

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={
            completed
              ? '/admin/tournaments/$tournamentId/standings'
              : '/admin/tournaments/$tournamentId/pairings'
          }
          params={{ tournamentId: publicCode }}
          search={{ phase: phaseOrder, round: round.roundNumber }}
          aria-label={`${phaseName}, ${round.roundName}: view ${view}`}
          aria-current={isCurrent ? 'page' : undefined}
          className={cn(
            nodeClassName,
            'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            completed
              ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/85'
              : 'border-primary bg-background text-primary ring-2 ring-primary/25 hover:bg-primary/10',
            isCurrent &&
              'outline-none ring-2 ring-ring ring-offset-2 ring-offset-background',
          )}
        >
          {round.roundNumber}
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        {phaseName} · {round.roundName} ·{' '}
        {completed ? 'Completed — view standings' : 'In progress — view pairings'}
      </TooltipContent>
    </Tooltip>
  )
}

function InertNode({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            nodeClassName,
            'border-dashed border-border text-muted-foreground/70',
          )}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
