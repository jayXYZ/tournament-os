import {
  Link,
  useLocation,
  useNavigate,
  useSearch,
} from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import {
  Globe,
  ListOrdered,
  Send,
  Swords,
  TimerIcon,
  Trophy,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { RoundTimerChip } from './round-timer-chip'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import {
  parseRoundSelectionSearch,
  useTournamentRoundNavigation,
} from '@/components/tournaments'
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
type ActiveRoundStep =
  | 'pairingsReady'
  | 'timerReady'
  | 'playing'
  | 'readyToComplete'

type ActiveRoundProgress = {
  roundId: Id<'tournamentRounds'>
  step: ActiveRoundStep
}

type BetweenRoundTarget = {
  phaseId: Id<'tournamentPhases'>
  slotIndex: number
}

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

// The backend's next action is also the most precise description of an active
// round's lifecycle. Keep that meaning on the node itself: the action button
// can then move around the dashboard without separating the state from the
// round it describes.
function activeRoundProgress(board: PairingsBoard): ActiveRoundProgress | null {
  const { nextStep } = board
  if (nextStep.kind === 'publishPairings') {
    return { roundId: nextStep.roundId, step: 'pairingsReady' }
  }
  if (nextStep.kind === 'completeRound') {
    return {
      roundId: nextStep.roundId,
      step: nextStep.ready ? 'readyToComplete' : 'playing',
    }
  }
  if (nextStep.kind !== 'startTimer') {
    return null
  }

  const activeRound = board.phases
    .flatMap(({ rounds }) => rounds)
    .find((round) => round.roundStatus === 'in_progress')
  return activeRound ? { roundId: activeRound._id, step: 'timerReady' } : null
}

// Once a completed round is waiting for the next one to be generated, the
// next planned slot becomes the bar's current step. This works within a phase
// and across phase boundaries, including dynamic phases whose node is "?".
function betweenRoundTarget(
  board: PairingsBoard,
  startNumbers: Array<number | null>,
): BetweenRoundTarget | null {
  const betweenRounds =
    board.tournament.lifecycle === 'in_progress' &&
    board.nextStep.kind === 'generateNextRound'
  if (!betweenRounds) {
    return null
  }

  let lastRoundPhaseIndex = -1
  for (const [index, phaseBoard] of board.phases.entries()) {
    if (phaseBoard.rounds.length > 0) {
      lastRoundPhaseIndex = index
    }
  }

  for (
    let phaseIndex = Math.max(lastRoundPhaseIndex, 0);
    phaseIndex < board.phases.length;
    phaseIndex++
  ) {
    const phaseBoard = board.phases[phaseIndex]
    const slots = phaseSlots(phaseBoard, startNumbers[phaseIndex])
    const slotIndex = slots.findIndex((slot) => slot.kind !== 'round')
    if (slotIndex !== -1) {
      return { phaseId: phaseBoard.phase._id, slotIndex }
    }
  }

  return null
}

// The timeline destination the organizer is currently viewing. Pairings and
// standings both fall back to their latest available round when the URL has no
// explicit selection, so resolve the timeline through that same navigation
// logic. This keeps the selected ring in sync with the content on first load
// and after clicking an already-active Pairings or Standings navigation item.
type CurrentTimelineSelection =
  | {
      view: 'pairings' | 'standings'
      phase: number
      round: number
      meeting?: never
    }
  | {
      view: 'pairings'
      phase: number
      meeting: true
      round?: never
    }

function useCurrentTimelineSelection(
  phases: Array<PhaseBoard>,
): CurrentTimelineSelection | null {
  const pathname = useLocation().pathname
  const search = parseRoundSelectionSearch(useSearch({ strict: false }))

  const view = pathname.endsWith('/pairings')
    ? 'pairings'
    : pathname.endsWith('/standings')
      ? 'standings'
      : null
  const navigation = useTournamentRoundNavigation(
    phases,
    view === 'standings' ? 'completed' : 'all',
    search,
    () => undefined,
  )
  const activePhase = navigation.activePhase?.phase

  if (!view || !activePhase) {
    return null
  }

  if (view === 'pairings' && navigation.isPlayerMeetingSelected) {
    return { view, phase: activePhase.phaseOrder, meeting: true }
  }
  if (!navigation.selectedRound) {
    return null
  }
  return {
    view,
    phase: activePhase.phaseOrder,
    round: navigation.selectedRound.roundNumber,
  }
}

// A segmented progress strip for the tournament manager: one node per round,
// grouped into labeled phase sections. Filled nodes are completed rounds and
// link to that round's standings; the ringed node is the in-progress round and
// links to its pairings. The strip also carries the tournament's single
// advance action (publish / start / next round / complete round / complete), so
// it renders as soon as the board loads — even before any rounds exist.
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
  const currentSelection = useCurrentTimelineSelection(board?.phases ?? [])
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
  const activeProgress = activeRoundProgress(board)
  const betweenTarget = betweenRoundTarget(board, startNumbers)

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
                currentSelection={currentSelection}
                activeProgress={activeProgress}
                playerMeetingIsNext={
                  board.nextStep.kind === 'startPlayerMeeting' &&
                  board.nextStep.phaseId === phaseBoard.phase._id
                }
                betweenRoundSlotIndex={
                  betweenTarget?.phaseId === phaseBoard.phase._id
                    ? betweenTarget.slotIndex
                    : null
                }
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
  const startPlayerMeeting = useMutation(
    api.tournaments.playerMeeting.startPlayerMeeting,
  )
  const publishTournament = useMutation(
    api.tournaments.lifecycle.publishTournament,
  )
  const startTournament = useMutation(api.tournaments.rounds.startTournament)
  const publishPairings = useMutation(api.tournaments.rounds.publishPairings)
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
    publishTournament,
    startPlayerMeeting,
    startTournament,
    publishPairings,
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
    <div
      className={cn('shrink-0', step.ready && 'advance-step-attention')}
      data-attention={step.ready || undefined}
    >
      <HoldButton
        disabled={!step.ready}
        onConfirm={handleAdvance}
        successLabel={action.success}
      >
        {action.icon}
        {step.ready ? action.label : (step.reason ?? action.label)}
      </HoldButton>
    </div>
  )
}

function advanceAction(
  step: AdvanceStep,
  tournamentId: Id<'tournaments'>,
  mutations: {
    publishTournament: (args: {
      tournamentId: Id<'tournaments'>
    }) => Promise<unknown>
    startPlayerMeeting: (args: {
      phaseId: Id<'tournamentPhases'>
    }) => Promise<unknown>
    startTournament: (args: {
      tournamentId: Id<'tournaments'>
    }) => Promise<unknown>
    publishPairings: (args: {
      roundId: Id<'tournamentRounds'>
    }) => Promise<unknown>
    startTimer: (args: { tournamentId: Id<'tournaments'> }) => Promise<unknown>
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
    case 'publishTournament':
      return {
        label: 'Hold to publish and open registration',
        icon: <Globe />,
        success: 'Registration opened',
        run: () => mutations.publishTournament({ tournamentId }),
      }
    case 'startPlayerMeeting':
      return {
        label: 'Hold to start player meeting',
        icon: <Users />,
        success: 'Meeting started',
        run: () => mutations.startPlayerMeeting({ phaseId: step.phaseId }),
      }
    case 'startTournament':
      return {
        label: 'Hold to generate pairings',
        icon: <Swords />,
        success: 'Pairings generated',
        run: () => mutations.startTournament({ tournamentId }),
      }
    case 'publishPairings':
      return {
        label: 'Hold to publish pairings',
        icon: <Send />,
        success: 'Pairings published',
        run: () => mutations.publishPairings({ roundId: step.roundId }),
      }
    case 'startTimer':
      return {
        label: 'Hold to start round timer',
        icon: <TimerIcon />,
        success: 'Timer started',
        run: () => mutations.startTimer({ tournamentId }),
      }
    case 'completeRound':
      return {
        label: 'Hold to complete round and post standings',
        icon: <ListOrdered />,
        success: 'Round completed',
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
  currentSelection,
  activeProgress,
  playerMeetingIsNext,
  betweenRoundSlotIndex,
}: {
  phaseBoard: PhaseBoard
  startNumber: number | null
  publicCode: string
  showLabel: boolean
  currentSelection: CurrentTimelineSelection | null
  activeProgress: ActiveRoundProgress | null
  playerMeetingIsNext: boolean
  betweenRoundSlotIndex: number | null
}) {
  const { phase } = phaseBoard
  const slots = phaseSlots(phaseBoard, startNumber)
  const hasPlayerMeeting = phase.playerMeeting === true
  if (slots.length === 0 && !hasPlayerMeeting) {
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
        {hasPlayerMeeting ? (
          <li className="flex items-center">
            <PlayerMeetingNode
              phaseOrder={phase.phaseOrder}
              phaseName={phaseName}
              publicCode={publicCode}
              status={phase.playerMeetingStatus}
              isNext={playerMeetingIsNext}
              isCurrent={
                currentSelection?.view === 'pairings' &&
                currentSelection.phase === phase.phaseOrder &&
                currentSelection.meeting === true
              }
            />
          </li>
        ) : null}
        {slots.map((slot, index) => {
          const previous = index > 0 ? slots[index - 1] : undefined
          const isBetweenRoundTarget = index === betweenRoundSlotIndex
          const filled =
            (previous?.kind === 'round' &&
              previous.round.roundStatus === 'completed') ||
            (index === 0 && phase.playerMeetingStatus === 'completed')
          return (
            <li
              // A timeline position keeps its identity when a planned round
              // becomes real, allowing its connector fill to transition.
              key={`slot-${index}`}
              className="flex items-center"
            >
              {previous || hasPlayerMeeting ? (
                <span
                  aria-hidden
                  className="h-0.5 w-3 overflow-hidden bg-border sm:w-5"
                >
                  <span
                    className={cn(
                      'block h-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none',
                      isBetweenRoundTarget
                        ? 'w-1/2'
                        : filled
                          ? 'w-full'
                          : 'w-0',
                    )}
                  />
                </span>
              ) : null}
              <RoundNode
                slot={slot}
                phaseOrder={phase.phaseOrder}
                phaseName={phaseName}
                publicCode={publicCode}
                currentSelection={currentSelection}
                activeStep={
                  slot.kind === 'round' &&
                  activeProgress?.roundId === slot.round._id
                    ? activeProgress.step
                    : null
                }
                isBetweenRounds={isBetweenRoundTarget}
              />
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const nodeClassName =
  'flex size-6 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums transition-[color,background-color,border-color,box-shadow,transform] duration-300 ease-out motion-reduce:transition-none'

const nodeEntranceClassName =
  'animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none'

function PlayerMeetingNode({
  phaseOrder,
  phaseName,
  publicCode,
  status,
  isNext,
  isCurrent,
}: {
  phaseOrder: number
  phaseName: string
  publicCode: string
  status: PhaseBoard['phase']['playerMeetingStatus']
  isNext: boolean
  isCurrent: boolean
}) {
  if (status === undefined) {
    return (
      <InertNode
        label="PM"
        tooltip={
          isNext
            ? `${phaseName} · Player meeting is next`
            : `${phaseName} · Player meeting · Not started`
        }
        isBetweenRounds={isNext}
      />
    )
  }

  const completed = status === 'completed'
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/admin/tournaments/$tournamentId/pairings"
          params={{ tournamentId: publicCode }}
          search={{ phase: phaseOrder, meeting: true }}
          aria-label={`${phaseName}, player meeting: ${completed ? 'completed' : 'in progress'}; view seating`}
          aria-current={isCurrent ? 'page' : undefined}
          className={cn(
            nodeClassName,
            nodeEntranceClassName,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            completed
              ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/85'
              : 'border-round-live bg-round-live/10 text-round-live ring-2 ring-round-live/20 hover:bg-round-live/20',
            isCurrent &&
              'outline-none ring-2 ring-ring ring-offset-2 ring-offset-background',
          )}
        >
          PM
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        {phaseName} · Player meeting · {completed ? 'Completed' : 'In progress'}{' '}
        — view seating
      </TooltipContent>
    </Tooltip>
  )
}

function RoundNode({
  slot,
  phaseOrder,
  phaseName,
  publicCode,
  currentSelection,
  activeStep,
  isBetweenRounds,
}: {
  slot: RoundSlot
  phaseOrder: number
  phaseName: string
  publicCode: string
  currentSelection: CurrentTimelineSelection | null
  activeStep: ActiveRoundStep | null
  isBetweenRounds: boolean
}) {
  if (slot.kind !== 'round') {
    if (slot.kind === 'unknown') {
      return (
        <InertNode
          label="?"
          tooltip={
            isBetweenRounds
              ? `${phaseName} · Between rounds · Next round is not generated yet`
              : `${phaseName} · More rounds may follow`
          }
          isBetweenRounds={isBetweenRounds}
        />
      )
    }
    return (
      <InertNode
        label={slot.roundNumber === null ? '?' : String(slot.roundNumber)}
        tooltip={
          isBetweenRounds
            ? `${phaseName} · Between rounds · Round ${slot.roundNumber ?? 'pending'} is next`
            : slot.roundNumber === null
              ? `${phaseName} · Not started`
              : `${phaseName} · Round ${slot.roundNumber} · Not started`
        }
        isBetweenRounds={isBetweenRounds}
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
  const progress = activeStep ? activeRoundStepPresentation[activeStep] : null
  // A completed round can be viewed in either Pairings or Standings even
  // though its timeline link defaults to Standings. Selection belongs to the
  // round, not to the view used to inspect it.
  const isCurrentRound =
    currentSelection?.phase === phaseOrder &&
    currentSelection.round === round.roundNumber
  const isCurrentPage = isCurrentRound && currentSelection.view === view

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
          aria-label={`${phaseName}, ${round.roundName}: ${progress?.label ?? (completed ? 'completed' : 'in progress')}; view ${view}`}
          aria-current={isCurrentPage ? 'page' : undefined}
          className={cn(
            nodeClassName,
            nodeEntranceClassName,
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            completed
              ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/85'
              : progress
                ? progress.className
                : 'border-primary bg-background text-primary ring-2 ring-primary/25 hover:bg-primary/10',
            isCurrentRound &&
              'outline-none ring-2 ring-ring ring-offset-2 ring-offset-background',
          )}
        >
          {round.roundNumber}
        </Link>
      </TooltipTrigger>
      <TooltipContent>
        {phaseName} · {round.roundName} ·{' '}
        {completed
          ? 'Completed — view standings'
          : `${progress?.tooltip ?? 'In progress'} — view pairings`}
      </TooltipContent>
    </Tooltip>
  )
}

const activeRoundStepPresentation: Record<
  ActiveRoundStep,
  { label: string; tooltip: string; className: string }
> = {
  pairingsReady: {
    label: 'pairings ready to publish',
    tooltip: 'Pairings ready to publish',
    className:
      'border-round-pairings bg-round-pairings/10 text-round-pairings ring-2 ring-round-pairings/20 hover:bg-round-pairings/20',
  },
  timerReady: {
    label: 'pairings published; timer not started',
    tooltip: 'Pairings published · Timer not started',
    className:
      'border-round-timer bg-round-timer/10 text-round-timer ring-2 ring-round-timer/20 hover:bg-round-timer/20',
  },
  playing: {
    label: 'round in progress',
    tooltip: 'Round in progress',
    className:
      'border-round-live bg-round-live/10 text-round-live ring-2 ring-round-live/20 hover:bg-round-live/20',
  },
  readyToComplete: {
    label: 'results reported; ready to complete',
    tooltip: 'Results reported · Ready to complete',
    className:
      'border-round-ready bg-round-ready/10 text-round-ready ring-2 ring-round-ready/20 hover:bg-round-ready/20',
  },
}

function InertNode({
  label,
  tooltip,
  isBetweenRounds = false,
}: {
  label: string
  tooltip: string
  isBetweenRounds?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={tooltip.replaceAll(' · ', ', ')}
          aria-current={isBetweenRounds ? 'step' : undefined}
          className={cn(
            nodeClassName,
            'border-dashed border-border text-muted-foreground/70',
            isBetweenRounds && 'relative',
          )}
        >
          {label}
          {isBetweenRounds ? (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-round-between ring-2 ring-background duration-200 ease-out animate-in fade-in-0 zoom-in-50 motion-reduce:animate-none"
            />
          ) : null}
        </span>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}
