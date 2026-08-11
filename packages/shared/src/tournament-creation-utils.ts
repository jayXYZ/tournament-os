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
  phaseCutoff?: TournamentCreationPhaseCutoffPayload;
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
    phaseCutoffKind: "none",
    phaseCutoffValue: "8",
    playerMeeting: false,
  };
}

// A cutoff cuts the field when its phase completes, so it is configurable
// only on a Swiss phase followed by another Swiss phase — the top-8 playoff
// applies its own fixed cut.
export function canConfigureTournamentCreationPhaseCutoff(
  phases: TournamentCreationPhaseForm[],
  index: number,
) {
  return (
    phases[index]?.phaseType === "swiss" &&
    phases[index + 1]?.phaseType === "swiss"
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
  return [
    ...phases.slice(0, playoffIndex),
    nextPhase,
    ...phases.slice(playoffIndex),
  ];
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
  return reordered;
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
  return phases.filter((phase) => phase.id !== id);
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
    // Dropped rather than sent for phases that cannot carry one (last phase,
    // or feeding the playoff), so a cutoff configured before a reorder or
    // phase-type change does not fail backend validation.
    const phaseCutoff =
      phase.phaseCutoffKind !== "none" &&
      canConfigureTournamentCreationPhaseCutoff(phases, index)
        ? {
            phaseCutoff:
              phase.phaseCutoffKind === "top_X_players"
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
        phaseRoundMode: "fixed" as const,
      };
    }
    if (phase.phaseRoundMode === "dynamic") {
      return {
        phaseOrder,
        phaseType: "swiss" as const,
        phaseRoundMode: "dynamic" as const,
        ...phaseCutoff,
        ...playerMeeting,
      };
    }

    return {
      phaseOrder,
      phaseType: "swiss",
      phaseRoundMode: "fixed",
      phaseTotalRounds: Number(phase.phaseTotalRounds),
      ...phaseCutoff,
      ...playerMeeting,
    };
  });
}
