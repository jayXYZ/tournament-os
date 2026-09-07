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
import { mutationErrorMessage } from '@tournament-os/core'
import {
  activeRoundProgress,
  advanceAction,
  betweenRoundTarget,
  phaseSlots,
} from './progression-timeline'
import { RoundTimerChip } from './round-timer-chip'
import type {
  ActiveRoundProgress,
  ActiveRoundStep,
  PhaseBoard,
  RoundSlot,
} from './progression-timeline'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import type { PairingsBoard } from './pairings-board'
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

  const activeProgress = activeRoundProgress(board)
  const betweenTarget = betweenRoundTarget(board)

  return (
    <TooltipProvider>
      <nav
        aria-label="Tournament progress"
        className="shrink-0 border-b border-border bg-background"
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="-m-1 flex min-w-0 items-end gap-6 overflow-x-auto p-1">
            {board.phases.map((phaseBoard) => (
              <PhaseSection
                key={phaseBoard.phase._id}
                phaseBoard={phaseBoard}
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

  const tournamentId = board.tournament._id

  const action = advanceAction(step)
  const Icon = { Globe, Users, Swords, Send, TimerIcon, ListOrdered, Trophy }[
    action.icon
  ]
  function runAdvance() {
    switch (step.kind) {
      case 'publishTournament':
        return publishTournament({ tournamentId })
      case 'startPlayerMeeting':
        return startPlayerMeeting({ phaseId: step.phaseId })
      case 'startTournament':
        return startTournament({ tournamentId })
      case 'publishPairings':
        return publishPairings({ roundId: step.roundId })
      case 'startTimer':
        return startTimer({ tournamentId })
      case 'completeRound':
        return completeRound({ roundId: step.roundId })
      case 'generateNextRound':
        return generateNextRound({ tournamentId })
      case 'completeTournament':
        return completeTournament({ tournamentId })
    }
  }

  // The hold button confirms success on its own face; errors still toast.
  // Rethrow so the button skips its success state on failure.
  async function handleAdvance() {
    try {
      await runAdvance()
      // Starting the timer doesn't change which round is current, so keep
      // whatever round the organizer is viewing instead of resetting it.
      if (step.kind !== 'startTimer') {
        onAdvanced()
      }
    } catch (error) {
      toast.error(
        mutationErrorMessage(error, 'Could not advance the tournament.'),
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
        <Icon />
        {step.ready ? action.label : (step.reason ?? action.label)}
      </HoldButton>
    </div>
  )
}

function PhaseSection({
  phaseBoard,
  publicCode,
  showLabel,
  currentSelection,
  activeProgress,
  playerMeetingIsNext,
  betweenRoundSlotIndex,
}: {
  phaseBoard: PhaseBoard
  publicCode: string
  showLabel: boolean
  currentSelection: CurrentTimelineSelection | null
  activeProgress: ActiveRoundProgress | null
  playerMeetingIsNext: boolean
  betweenRoundSlotIndex: number | null
}) {
  const { phase } = phaseBoard
  const slots = phaseSlots(phaseBoard)
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
            (index === 0 &&
              phase.playerMeetingStatus !== undefined &&
              phase.playerMeetingStatus !== 'in_progress')
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

  // "superseded" (the phase's first round was rewound after the meeting)
  // renders as completed: the meeting itself did finish.
  const completed = status !== 'in_progress'
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
