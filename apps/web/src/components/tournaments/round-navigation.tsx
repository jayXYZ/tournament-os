import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'

export type RoundNavigationMode = 'all' | 'completed'

// Which phase/round the user is looking at, addressed by phaseOrder and
// roundNumber (stable, human-readable) rather than Convex ids. Lives in the
// route's search params so the tournament progress bar can deep-link to a
// specific round from anywhere in the manager.
export type RoundSelection = {
  phase?: number
  round?: number
  meeting?: true
}

// validateSearch for routes that carry a timeline selection. The router's
// search parser already restores numeric and boolean values; anything else is
// dropped.
export function parseRoundSelectionSearch(
  search: Record<string, unknown>,
): RoundSelection {
  const phase = typeof search.phase === 'number' ? search.phase : undefined

  // A player meeting and a round are separate timeline destinations. Keep the
  // parsed selection mutually exclusive even if a hand-edited URL contains
  // both search params.
  if (search.meeting === true) {
    return { phase, meeting: true }
  }

  return {
    phase,
    round: typeof search.round === 'number' ? search.round : undefined,
  }
}

export type TournamentRoundNavigationPhase = {
  phase: Pick<
    Doc<'tournamentPhases'>,
    | '_id'
    | 'bestOf'
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
) {
  const roundsForMode = (rounds: TournamentRoundNavigationPhase['rounds']) =>
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
      ? phases.find(({ phase }) => phase.playerMeetingStatus === 'in_progress')
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
  const isPlayerMeetingSelected =
    mode === 'all' &&
    activePhase?.phase.playerMeetingStatus !== undefined &&
    (selection.meeting === true ||
      (selection.round === undefined &&
        activePhase.phase.playerMeetingStatus === 'in_progress'))
  const selectedRound = isPlayerMeetingSelected
    ? undefined
    : (availableRounds.find((round) => round.roundNumber === selection.round) ??
      availableRounds.at(-1))

  return {
    activePhase,
    availableRounds,
    isPlayerMeetingSelected,
    selectedRound,
  }
}
