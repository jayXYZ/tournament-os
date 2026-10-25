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

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { mutationErrorMessage } from '@paper-pairings/core'
import { LiveStatusBand } from './live-status-band'
import { phaseLabel } from './phase-label'
import {
  activeRoundProgress,
  activeRoundStepPresentation,
  advanceAction,
  betweenRoundTarget,
  phaseSlots,
} from './progression-timeline'
import { RoundTimerChip } from './round-timer-chip'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { PairingsBoard } from './pairings-board'
import type {
  ActiveRoundProgress,
  ActiveRoundStep,
  AdvanceStep,
  PhaseBoard,
  ProgressBarDensity,
  RoundSlot,
} from './progression-timeline'
import {
  parseRoundSelectionSearch,
  useTournamentRoundNavigation,
} from '@/components/tournaments'
import { pageColumnClasses } from '@/components/shared/page-column'
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
// link to that round's standings; the accent node is the in-progress round
// and links to its pairings. The strip also carries the tournament's single
// advance action (publish / start / next round / complete round / complete),
// so it renders as soon as the board loads — even before any rounds exist.
export function TournamentProgressBar({
  tournamentId,
  publicCode,
  density = 'compact',
}: {
  tournamentId: Id<'tournaments'>
  publicCode: string
  density?: ProgressBarDensity
}) {
  const board = useQuery(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  })
  const currentSelection = useCurrentTimelineSelection(board?.phases ?? [])
  const navigate = useNavigate()

  // Keep the bar's shell (and the advance control's slot) visible while the
  // board loads so the layout doesn't jump when it resolves.
  if (!board) {
    if (density === 'expanded') {
      return (
        <div aria-busy className="flex flex-col gap-4">
          <Skeleton className="h-28 rounded-lg" />
          <div className="flex items-center gap-3 px-1">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="size-6 rounded-full" />
            ))}
          </div>
        </div>
      )
    }
    return (
      <nav
        aria-label="Tournament progress"
        aria-busy
        className="shrink-0 border-b border-border bg-background"
      >
        <div
          className={cn(
            pageColumnClasses,
            'flex items-center justify-between gap-6 py-2.5',
          )}
        >
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
  // Named once, in order, so a phase and the section after it (which cites
  // it as "rounds set after X") agree on what it is called: an unnamed
  // bracket takes its name from the cut before it (phaseLabel).
  const phaseNames = board.phases.map((phaseBoard, phaseIndex) =>
    phaseLabel(
      phaseBoard.phase,
      phaseIndex > 0 ? board.phases[phaseIndex - 1].phase : undefined,
    ),
  )
  // Clearing the search params lets the pairings/standings views fall back
  // to the newly current phase and round.
  const onAdvanced = () => void navigate({ to: '.', search: {}, replace: true })

  const timeline = (
    <div className="-m-1 flex min-w-0 items-end gap-6 overflow-x-auto p-1">
      {board.phases.map((phaseBoard, phaseIndex) => (
        <PhaseSection
          key={phaseBoard.phase._id}
          phaseBoard={phaseBoard}
          phaseName={phaseNames[phaseIndex]}
          previousPhaseName={phaseIndex > 0 ? phaseNames[phaseIndex - 1] : null}
          publicCode={publicCode}
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
  )

  if (density === 'expanded') {
    return (
      <TooltipProvider>
        <div className="flex flex-col gap-4">
          <LiveStatusBand
            board={board}
            publicCode={publicCode}
            action={
              <AdvanceStepButton
                board={board}
                density="expanded"
                onAdvanced={onAdvanced}
              />
            }
          />
          <nav aria-label="Tournament timeline" className="px-1">
            {timeline}
          </nav>
        </div>
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
      <nav
        aria-label="Tournament progress"
        className="shrink-0 border-b border-border bg-background"
      >
        <div
          className={cn(
            pageColumnClasses,
            'flex items-center justify-between gap-6 py-2.5',
          )}
        >
          {timeline}
          <div className="flex shrink-0 items-center gap-3">
            <RoundTimerChip board={board} publicCode={publicCode} />
            <AdvanceStepButton
              board={board}
              density="compact"
              onAdvanced={onAdvanced}
            />
          </div>
        </div>
      </nav>
    </TooltipProvider>
  )
}

function AdvanceStepButton({
  board,
  density,
  onAdvanced,
}: {
  board: PairingsBoard
  density: ProgressBarDensity
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

  const action = advanceAction(board, density)
  if (action.kind === 'tournamentCancelled') {
    return <Badge variant="destructive">Tournament cancelled</Badge>
  }
  if (action.kind === 'tournamentCompleted') {
    return (
      <Button type="button" disabled>
        <Trophy />
        Tournament complete
      </Button>
    )
  }

  const { step } = action
  const tournamentId = board.tournament._id

  // The label, success flash, and hint come from advanceAction. Only the
  // icon and the mutation are chosen here.
  function advanceCommand(advanceStep: AdvanceStep) {
    switch (advanceStep.kind) {
      case 'publishTournament':
        return {
          icon: <Globe />,
          run: () => publishTournament({ tournamentId }),
        }
      case 'startPlayerMeeting':
        return {
          icon: <Users />,
          run: () => startPlayerMeeting({ phaseId: advanceStep.phaseId }),
        }
      case 'startTournament':
        return {
          icon: <Swords />,
          run: () => startTournament({ tournamentId }),
        }
      case 'publishPairings':
        return {
          icon: <Send />,
          run: () => publishPairings({ roundId: advanceStep.roundId }),
        }
      case 'startTimer':
        return {
          icon: <TimerIcon />,
          run: () => startTimer({ tournamentId }),
        }
      case 'completeRound':
        return {
          icon: <ListOrdered />,
          run: () => completeRound({ roundId: advanceStep.roundId }),
        }
      case 'generateNextRound':
        return {
          icon: <Swords />,
          run: () => generateNextRound({ tournamentId }),
        }
      case 'completeTournament':
        return {
          icon: <Trophy />,
          run: () => completeTournament({ tournamentId }),
        }
    }
  }

  const command = advanceCommand(step)
  const { resetsRoundSelection } = action

  // The hold button confirms success on its own face; errors still toast.
  // Rethrow so the button skips its success state on failure.
  async function handleAdvance() {
    try {
      await command.run()
      if (resetsRoundSelection) {
        onAdvanced()
      }
    } catch (error) {
      toast.error(
        mutationErrorMessage(error, 'Could not advance the tournament.'),
      )
      throw error
    }
  }

  return (
    <div
      className={cn('shrink-0', step.ready && 'advance-step-attention')}
      data-attention={step.ready || undefined}
    >
      <HoldButton
        variant="brand"
        disabled={!step.ready}
        onConfirm={handleAdvance}
        successLabel={action.successLabel}
        size={density === 'expanded' ? 'lg' : 'default'}
        title={action.title}
      >
        {command.icon}
        {action.label}
      </HoldButton>
    </div>
  )
}

function PhaseSection({
  phaseBoard,
  phaseName,
  previousPhaseName,
  publicCode,
  currentSelection,
  activeProgress,
  playerMeetingIsNext,
  betweenRoundSlotIndex,
}: {
  phaseBoard: PhaseBoard
  phaseName: string
  previousPhaseName: string | null
  publicCode: string
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

  const upcoming = phase.phaseStatus === 'upcoming'

  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      <span
        className={cn(
          'text-xs font-medium',
          upcoming ? 'text-muted-foreground' : 'text-foreground',
        )}
      >
        {phaseName}
      </span>
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
                previousPhaseName={previousPhaseName}
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
  'flex h-6 min-w-6 items-center justify-center rounded-full border text-[11px] font-medium tabular-nums transition-[color,background-color,border-color,box-shadow,transform] duration-300 ease-out motion-reduce:transition-none'

const nodeEntranceClassName =
  'animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none'

// Node states, each readable without color: completed is filled, the round in
// play is the accent, upcoming is a solid outline with full-contrast text,
// unresolved is dashed. The viewed round (Pairings and Standings) gets a
// foreground ring outside the node so it composes with any of them.
const completedNodeClassName =
  'border-foreground bg-foreground text-background hover:bg-foreground/85'
const upcomingNodeClassName =
  'border-muted-foreground/50 bg-card text-foreground'
const viewingNodeClassName =
  'outline-none ring-2 ring-foreground ring-offset-2 ring-offset-background'

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
  // A meeting is a step but not a round, so it is a pill with its name
  // rather than a numbered circle. ("PM" was an abbreviation nobody reads,
  // and any shorter form collides with the game.)
  if (status === undefined) {
    return (
      <InertNode
        label="Meeting"
        pill
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
            'px-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            completed
              ? completedNodeClassName
              : 'border-accent-brand bg-accent-brand/10 text-accent-brand ring-2 ring-accent-brand/20 hover:bg-accent-brand/20',
            isCurrent && viewingNodeClassName,
          )}
        >
          Meeting
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
  previousPhaseName,
  publicCode,
  currentSelection,
  activeStep,
  isBetweenRounds,
}: {
  slot: RoundSlot
  phaseOrder: number
  phaseName: string
  previousPhaseName: string | null
  publicCode: string
  currentSelection: CurrentTimelineSelection | null
  activeStep: ActiveRoundStep | null
  isBetweenRounds: boolean
}) {
  if (slot.kind !== 'round') {
    if (slot.kind === 'unknown') {
      // A phase whose length is not decided yet says so in words instead of
      // making uncertainty a node. Its round count resolves once the phase
      // before it ends (a cut sizes the bracket; a dynamic phase sizes
      // itself to its field).
      return (
        <span className="flex items-center gap-2">
          <InertNode
            label=""
            dashed
            tooltip={
              isBetweenRounds
                ? `${phaseName} · Between rounds · Next round is not generated yet`
                : `${phaseName} · Rounds are set once ${previousPhaseName ?? 'the phase before'} ends`
            }
            isBetweenRounds={isBetweenRounds}
          />
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {isBetweenRounds
              ? 'next round not generated yet'
              : `rounds set after ${previousPhaseName ?? 'the phase before'}`}
          </span>
        </span>
      )
    }
    return (
      <InertNode
        label={slot.roundNumber === null ? '' : String(slot.roundNumber)}
        dashed={slot.roundNumber === null}
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
              ? completedNodeClassName
              : (progress?.className ??
                  activeRoundStepPresentation.playing.className),
            isCurrentRound && viewingNodeClassName,
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

function InertNode({
  label,
  tooltip,
  dashed = false,
  pill = false,
  isBetweenRounds = false,
}: {
  label: string
  tooltip: string
  dashed?: boolean
  pill?: boolean
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
            upcomingNodeClassName,
            dashed && 'border-dashed',
            pill && 'px-2',
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
