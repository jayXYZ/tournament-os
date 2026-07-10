import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type RoundNavigationMode = 'all' | 'completed'

// Which phase/round the user is looking at, addressed by phaseOrder and
// roundNumber (stable, human-readable) rather than Convex ids. Lives in the
// route's search params so the tournament progress bar can deep-link to a
// specific round from anywhere in the manager.
export type RoundSelection = {
  phase?: number
  round?: number
}

// validateSearch for routes that carry a round selection. The router's search
// parser already turns numeric params into numbers; anything else is dropped.
export function parseRoundSelectionSearch(
  search: Record<string, unknown>,
): RoundSelection {
  return {
    phase: typeof search.phase === 'number' ? search.phase : undefined,
    round: typeof search.round === 'number' ? search.round : undefined,
  }
}

export type TournamentRoundNavigationPhase = {
  phase: Pick<
    Doc<'tournamentPhases'>,
    | '_id'
    | 'phaseName'
    | 'phaseOrder'
    | 'phaseStatus'
    | 'phaseTotalRounds'
    | 'playerMeetingStatus'
  >
  rounds: Array<
    Pick<Doc<'tournamentRounds'>, '_id' | 'roundNumber' | 'roundStatus'>
  >
}

// Selection state is owned by the caller (in practice, the route's search
// params via `parseRoundSelectionSearch`) so external navigation — like the
// tournament progress bar — can change it. A selection that doesn't match an
// available phase/round falls back to the latest phase with rounds the mode
// can show, and that phase's latest round.
export function useTournamentRoundNavigation(
  phases: Array<TournamentRoundNavigationPhase>,
  mode: RoundNavigationMode,
  selection: RoundSelection,
  onSelectionChange: (selection: RoundSelection) => void,
) {
  const roundsForMode = (
    rounds: TournamentRoundNavigationPhase['rounds'],
  ) =>
    mode === 'completed'
      ? rounds.filter((round) => round.roundStatus === 'completed')
      : rounds
  // Default to the latest phase with rounds this mode can show. An
  // in-progress phase without them (e.g. standings right after a new phase's
  // first round is paired) or a fully completed tournament should land on the
  // last phase that has content, not an empty phase or phase 1. In 'all' mode
  // a live player meeting wins: its phase has no rounds yet, but its meeting
  // seating is the content the organizer needs.
  const defaultPhase =
    (mode === 'all'
      ? phases.find(
          ({ phase }) => phase.playerMeetingStatus === 'in_progress',
        )
      : undefined) ??
    [...phases]
      .reverse()
      .find(({ rounds }) => roundsForMode(rounds).length > 0) ??
    phases.find(({ phase }) => phase.phaseStatus === 'in_progress') ??
    phases.at(0)
  const activePhase =
    phases.find(({ phase }) => phase.phaseOrder === selection.phase) ??
    defaultPhase
  const allRounds = activePhase?.rounds ?? []
  const availableRounds = roundsForMode(allRounds)
  const selectedRound =
    availableRounds.find((round) => round.roundNumber === selection.round) ??
    availableRounds.at(-1)
  const roundTabCount = Math.max(
    activePhase?.phase.phaseTotalRounds ?? 0,
    allRounds.length,
  )
  // Round numbers are global across phases (a later phase continues the
  // numbering), so tabs start at the phase's first actual round number.
  const firstRoundNumber = allRounds.at(0)?.roundNumber ?? 1

  return {
    activePhase,
    availableRounds,
    firstRoundNumber,
    phases,
    roundTabCount,
    selectedRound,
    selectPhase: (phaseId: string) => {
      const target = phases.find(({ phase }) => phase._id === phaseId)
      onSelectionChange(target ? { phase: target.phase.phaseOrder } : {})
    },
    selectRound: (roundNumber: number) =>
      onSelectionChange({
        phase: activePhase?.phase.phaseOrder,
        round: roundNumber,
      }),
  }
}

export function TournamentPhaseTabs({
  activePhaseId,
  onValueChange,
  phases,
}: {
  activePhaseId: string
  onValueChange: (phaseId: string) => void
  phases: Array<TournamentRoundNavigationPhase>
}) {
  if (phases.length <= 1) {
    return null
  }

  return (
    <Tabs value={activePhaseId} onValueChange={onValueChange}>
      <TabsList className="max-w-full justify-start overflow-x-auto">
        {phases.map(({ phase }) => (
          <TabsTrigger
            key={phase._id}
            value={phase._id}
            // An upcoming phase becomes selectable once its player meeting
            // starts, so the meeting seating stays reachable before the
            // phase's first round is paired.
            disabled={
              phase.phaseStatus === 'upcoming' &&
              phase.playerMeetingStatus === undefined
            }
          >
            {phase.phaseName ?? `Phase ${phase.phaseOrder}`}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}

export function TournamentRoundTabs({
  activeRoundNumber,
  availableRoundNumbers,
  firstRoundNumber = 1,
  onValueChange,
  roundCount,
}: {
  activeRoundNumber: number
  availableRoundNumbers: Array<number>
  // The phase's first global round number; tabs run from here.
  firstRoundNumber?: number
  onValueChange: (roundNumber: number) => void
  roundCount: number
}) {
  const availableRounds = new Set(availableRoundNumbers)

  return (
    <Tabs
      value={String(activeRoundNumber)}
      onValueChange={(value) => onValueChange(Number(value))}
    >
      <TabsList className="max-w-full justify-start overflow-x-auto">
        {Array.from({ length: roundCount }, (_, index) => {
          const roundNumber = firstRoundNumber + index
          return (
            <TabsTrigger
              key={roundNumber}
              value={String(roundNumber)}
              disabled={!availableRounds.has(roundNumber)}
            >
              Round {roundNumber}
            </TabsTrigger>
          )
        })}
      </TabsList>
    </Tabs>
  )
}
