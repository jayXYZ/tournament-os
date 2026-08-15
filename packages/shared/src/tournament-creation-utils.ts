import { DEFAULT_BEST_OF, isBestOf, type BestOf } from "./match-structure";

export const tournamentFormats = [
  "standard",
  "modern",
  "pioneer",
  "legacy",
  "vintage",
  "premodern",
  "sealed",
  "draft",
] as const;

export type TournamentFormat = (typeof tournamentFormats)[number];

export type TournamentCreationPhaseRoundMode = "dynamic" | "fixed";
export type TournamentCreationPhaseType = "swiss" | "single_elimination";
export type TournamentCreationPhaseCutoffKind =
  | "none"
  | "top_X_players"
  | "X_points_or_more";

export type TournamentCreationPhaseForm = {
  id: string;
  phaseType: TournamentCreationPhaseType;
  phaseRoundMode: TournamentCreationPhaseRoundMode;
  phaseTotalRounds: string;
  // Match Structure as a form string ("1" | "3" | "5"), like the other
  // numeric form fields.
  bestOf: string;
  phaseCutoffKind: TournamentCreationPhaseCutoffKind;
  phaseCutoffValue: string;
  playerMeeting: boolean;
};

export type TournamentCreationPhaseCutoffPayload =
  | { kind: "top_X_players"; playerCount: number }
  | { kind: "X_points_or_more"; matchPoints: number };

export type TournamentCreationPhasePayload = {
  phaseOrder: number;
  phaseType: TournamentCreationPhaseType;
  phaseRoundMode: TournamentCreationPhaseRoundMode;
  phaseTotalRounds?: number;
  bestOf?: BestOf;
  // Null is an explicit "no cut". Into a playoff the backend defaults an
  // omitted cut to top-8, so the two are not interchangeable there.
  phaseCutoff?: TournamentCreationPhaseCutoffPayload | null;
  playerMeeting?: boolean;
};

export const MAX_TOURNAMENT_PHASES = 16;

export function createDefaultTournamentCreationPhase(
  id: string,
): TournamentCreationPhaseForm {
  return {
    id,
    phaseType: "swiss",
    phaseRoundMode: "dynamic",
    phaseTotalRounds: "3",
    bestOf: String(DEFAULT_BEST_OF),
    phaseCutoffKind: "none",
    phaseCutoffValue: "8",
    playerMeeting: false,
  };
}

// A cutoff cuts the field when its phase completes, so it is configurable on
// any phase with a following phase to cut into, whatever that phase's type.
export function canConfigureTournamentCreationPhaseCutoff(
  phases: TournamentCreationPhaseForm[],
  index: number,
) {
  return (
    phases[index]?.phaseType === "swiss" && phases[index + 1] !== undefined
  );
}

// Whether this phase's cut is what seeds a single-elimination playoff. Such
// a phase defaults to a top-8 cut, and both a points bar and "no cut" here
// deserve a warning: the bracket size becomes unpredictable.
export function tournamentCreationPhaseCutoffFeedsPlayoff(
  phases: TournamentCreationPhaseForm[],
  index: number,
) {
  return (
    phases[index]?.phaseType === "swiss" &&
    phases[index + 1]?.phaseType === "single_elimination"
  );
}

// Into a playoff the default cut is top-8 (CONTEXT.md "Cut"), so a
// structural edit that puts a phase in front of a playoff pre-fills that
// default where the organizer can see it — and change it, including to an
// explicit "No cut". Only a phase that newly feeds the playoff is touched:
// a "none" the organizer chose on a phase already feeding it survives later
// structural edits.
function withPlayoffCutDefaults(
  previousPhases: TournamentCreationPhaseForm[],
  phases: TournamentCreationPhaseForm[],
) {
  const previouslyFeedingIds = new Set(
    previousPhases
      .filter((_, index) =>
        tournamentCreationPhaseCutoffFeedsPlayoff(previousPhases, index),
      )
      .map((phase) => phase.id),
  );
  return phases.map((phase, index) =>
    phase.phaseCutoffKind === "none" &&
    !previouslyFeedingIds.has(phase.id) &&
    tournamentCreationPhaseCutoffFeedsPlayoff(phases, index)
      ? {
          ...phase,
          phaseCutoffKind: "top_X_players" as const,
          phaseCutoffValue: "8",
        }
      : phase,
  );
}

export function setTournamentCreationPhaseType(
  phases: TournamentCreationPhaseForm[],
  id: string,
  phaseType: TournamentCreationPhaseType,
) {
  return withPlayoffCutDefaults(
    phases,
    phases.map((phase) =>
      phase.id === id
        ? {
            ...phase,
            phaseType,
            // A bracket's round count resolves from its entering field when
            // the phase starts, like a dynamic Swiss phase's.
            ...(phaseType === "single_elimination"
              ? {
                  phaseRoundMode: "dynamic" as const,
                  playerMeeting: false,
                }
              : {}),
          }
        : phase,
    ),
  );
}

export function addTournamentCreationPhase(
  phases: TournamentCreationPhaseForm[],
  id: string,
) {
  const nextPhase = createDefaultTournamentCreationPhase(id);
  const playoffIndex = phases.findIndex(
    (phase) => phase.phaseType === "single_elimination",
  );
  if (playoffIndex === -1) {
    return [...phases, nextPhase];
  }
  return withPlayoffCutDefaults(phases, [
    ...phases.slice(0, playoffIndex),
    nextPhase,
    ...phases.slice(playoffIndex),
  ]);
}

function hasValidTournamentPhaseOrder(phases: TournamentCreationPhaseForm[]) {
  return (
    phases.length > 0 &&
    phases.length <= MAX_TOURNAMENT_PHASES &&
    phases[0].phaseType === "swiss" &&
    phases.every(
      (phase, index) =>
        phase.phaseType !== "single_elimination" || index === phases.length - 1,
    )
  );
}

export function canMoveTournamentCreationPhase(
  phases: TournamentCreationPhaseForm[],
  id: string,
  direction: -1 | 1,
) {
  const currentIndex = phases.findIndex((phase) => phase.id === id);
  const nextIndex = currentIndex + direction;
  if (currentIndex === -1 || nextIndex < 0 || nextIndex >= phases.length) {
    return false;
  }

  const reordered = [...phases];
  [reordered[currentIndex], reordered[nextIndex]] = [
    reordered[nextIndex],
    reordered[currentIndex],
  ];
  return hasValidTournamentPhaseOrder(reordered);
}

export function moveTournamentCreationPhase(
  phases: TournamentCreationPhaseForm[],
  id: string,
  direction: -1 | 1,
) {
  if (!canMoveTournamentCreationPhase(phases, id, direction)) {
    return phases;
  }

  const currentIndex = phases.findIndex((phase) => phase.id === id);
  const nextIndex = currentIndex + direction;
  const reordered = [...phases];
  [reordered[currentIndex], reordered[nextIndex]] = [
    reordered[nextIndex],
    reordered[currentIndex],
  ];
  return withPlayoffCutDefaults(phases, reordered);
}

export function canRemoveTournamentCreationPhase(
  phases: TournamentCreationPhaseForm[],
  id: string,
) {
  const remainingPhases = phases.filter((phase) => phase.id !== id);
  return (
    remainingPhases.length < phases.length &&
    remainingPhases[0]?.phaseType === "swiss"
  );
}

export function removeTournamentCreationPhase(
  phases: TournamentCreationPhaseForm[],
  id: string,
) {
  if (!canRemoveTournamentCreationPhase(phases, id)) {
    return phases;
  }
  return withPlayoffCutDefaults(
    phases,
    phases.filter((phase) => phase.id !== id),
  );
}

export function toTournamentCreationPhasePayload(
  phases: TournamentCreationPhaseForm[],
): TournamentCreationPhasePayload[] {
  return phases.map((phase, index) => {
    const phaseOrder = index + 1;
    // Emitted only when true, matching the backend's absent-default field.
    const playerMeeting = phase.playerMeeting
      ? { playerMeeting: true as const }
      : {};
    // Sent only when it parses to a supported structure; the backend defaults
    // a missing value to best-of-3.
    const parsedBestOf = Number(phase.bestOf);
    const bestOf = isBestOf(parsedBestOf) ? { bestOf: parsedBestOf } : {};
    // The form's cut is stated explicitly wherever one can apply — null for
    // "none", since into a playoff the backend defaults an omitted cut to
    // top-8 and a form showing "No cut" must say so. Dropped entirely where
    // no cut can apply (the last phase has nothing to cut into), so a cutoff
    // configured before a reorder or phase-type change does not fail backend
    // validation.
    const phaseCutoff = canConfigureTournamentCreationPhaseCutoff(phases, index)
      ? {
          phaseCutoff:
            phase.phaseCutoffKind === "none"
              ? null
              : phase.phaseCutoffKind === "top_X_players"
                ? {
                    kind: "top_X_players" as const,
                    playerCount: Number(phase.phaseCutoffValue),
                  }
                : {
                    kind: "X_points_or_more" as const,
                    matchPoints: Number(phase.phaseCutoffValue),
                  },
        }
      : {};
    if (phase.phaseType === "single_elimination") {
      return {
        phaseOrder,
        phaseType: "single_elimination" as const,
        phaseRoundMode: "dynamic" as const,
        ...bestOf,
      };
    }
    if (phase.phaseRoundMode === "dynamic") {
      return {
        phaseOrder,
        phaseType: "swiss" as const,
        phaseRoundMode: "dynamic" as const,
        ...bestOf,
        ...phaseCutoff,
        ...playerMeeting,
      };
    }

    return {
      phaseOrder,
      phaseType: "swiss",
      phaseRoundMode: "fixed",
      phaseTotalRounds: Number(phase.phaseTotalRounds),
      ...bestOf,
      ...phaseCutoff,
      ...playerMeeting,
    };
  });
}
