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

export type TournamentCreationPhaseForm = {
  id: string;
  phaseType: TournamentCreationPhaseType;
  phaseRoundMode: TournamentCreationPhaseRoundMode;
  phaseTotalRounds: string;
  playerMeeting: boolean;
};

export type TournamentCreationPhasePayload = {
  phaseOrder: number;
  phaseType: TournamentCreationPhaseType;
  phaseRoundMode: TournamentCreationPhaseRoundMode;
  phaseTotalRounds?: number;
  playerMeeting?: boolean;
};

export function createDefaultTournamentCreationPhase(
  id: string,
): TournamentCreationPhaseForm {
  return {
    id,
    phaseType: "swiss",
    phaseRoundMode: "dynamic",
    phaseTotalRounds: "3",
    playerMeeting: false,
  };
}

export function addTournamentCreationPhase(
  phases: TournamentCreationPhaseForm[],
  id: string,
) {
  return [...phases, createDefaultTournamentCreationPhase(id)];
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
        ...playerMeeting,
      };
    }

    return {
      phaseOrder,
      phaseType: "swiss",
      phaseRoundMode: "fixed",
      phaseTotalRounds: Number.parseInt(phase.phaseTotalRounds, 10),
      ...playerMeeting,
    };
  });
}
