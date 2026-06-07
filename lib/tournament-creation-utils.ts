export type TournamentCreationPhaseRoundMode = "dynamic" | "fixed";

export type TournamentCreationPhaseForm = {
  id: string;
  phaseRoundMode: TournamentCreationPhaseRoundMode;
  phaseTotalRounds: string;
};

export type TournamentCreationPhasePayload = {
  phaseOrder: number;
  phaseRoundMode: TournamentCreationPhaseRoundMode;
  phaseTotalRounds?: number;
};

export function createDefaultTournamentCreationPhase(
  id: string,
): TournamentCreationPhaseForm {
  return {
    id,
    phaseRoundMode: "dynamic",
    phaseTotalRounds: "3",
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
    if (phase.phaseRoundMode === "dynamic") {
      return { phaseOrder, phaseRoundMode: "dynamic" };
    }

    return {
      phaseOrder,
      phaseRoundMode: "fixed",
      phaseTotalRounds: Number.parseInt(phase.phaseTotalRounds, 10),
    };
  });
}
