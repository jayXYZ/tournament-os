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

export type TournamentCreationPhaseForm = {
  id: string;
  phaseRoundMode: TournamentCreationPhaseRoundMode;
  phaseTotalRounds: string;
  playerMeeting: boolean;
};

export type TournamentCreationPhasePayload = {
  phaseOrder: number;
  phaseRoundMode: TournamentCreationPhaseRoundMode;
  phaseTotalRounds?: number;
  playerMeeting?: boolean;
};

export function createDefaultTournamentCreationPhase(
  id: string,
): TournamentCreationPhaseForm {
  return {
    id,
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

export function removeTournamentCreationPhase(
  phases: TournamentCreationPhaseForm[],
  id: string,
) {
  if (phases.length <= 1) {
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
    if (phase.phaseRoundMode === "dynamic") {
      return { phaseOrder, phaseRoundMode: "dynamic", ...playerMeeting };
    }

    return {
      phaseOrder,
      phaseRoundMode: "fixed",
      phaseTotalRounds: Number.parseInt(phase.phaseTotalRounds, 10),
      ...playerMeeting,
    };
  });
}
