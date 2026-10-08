import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'

type PhaseLabelSource = Pick<
  Doc<'tournamentPhases'>,
  'phaseName' | 'phaseType' | 'phaseOrder' | 'phaseCutoff'
>

// The name a phase is called by across the manager. An organizer-given name
// wins; otherwise the format says what the phase is ("Swiss", "Top 8"),
// which reads better on a timeline than "Phase 2". A phase's cutoff is the
// cut out of it (CONTEXT.md "Cut"), so a bracket is named by the cut the
// phase before it makes.
export function phaseLabel(
  phase: PhaseLabelSource,
  previousPhase?: PhaseLabelSource,
) {
  if (phase.phaseName) {
    return phase.phaseName
  }
  if (phase.phaseType === 'swiss') {
    return 'Swiss'
  }
  if (previousPhase?.phaseCutoff?.kind === 'top_X_players') {
    return `Top ${previousPhase.phaseCutoff.playerCount}`
  }
  return 'Single elimination'
}
