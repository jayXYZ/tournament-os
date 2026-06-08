import type { FormEvent } from "react";

import type { Id } from "@/convex/_generated/dataModel";
import type { TournamentCreationPhaseForm } from "@/lib/tournament-creation-utils";
import { CreateTournamentDialog } from "./create-tournament-dialog";
import { TournamentTable } from "./tournament-table";
import type { BusyState, Tournament } from "./types";

export function TournamentAdminView({
  busy,
  createTournamentOpen,
  onAddTournamentPhase,
  onCreateTournament,
  onCreateTournamentOpenChange,
  onRemoveTournamentPhase,
  onTournamentIsTestEventChange,
  onTournamentNameChange,
  onTournamentPhasesChange,
  onTournamentPlayerCapacityChange,
  onTournamentStartDateTimeChange,
  selectedOrganizationId,
  selectedOrganizationName,
  tournamentName,
  tournamentIsTestEvent,
  tournamentPhases,
  tournamentPlayerCapacity,
  tournamentStartDateTime,
  tournaments,
}: {
  busy: BusyState;
  createTournamentOpen: boolean;
  onAddTournamentPhase: () => void;
  onCreateTournament: (event: FormEvent<HTMLFormElement>) => void;
  onCreateTournamentOpenChange: (open: boolean) => void;
  onRemoveTournamentPhase: (id: string) => void;
  onTournamentIsTestEventChange: (value: boolean) => void;
  onTournamentNameChange: (value: string) => void;
  onTournamentPhasesChange: (phases: TournamentCreationPhaseForm[]) => void;
  onTournamentPlayerCapacityChange: (value: string) => void;
  onTournamentStartDateTimeChange: (value: string) => void;
  selectedOrganizationId: Id<"organizations"> | null;
  selectedOrganizationName?: string;
  tournamentName: string;
  tournamentIsTestEvent: boolean;
  tournamentPhases: TournamentCreationPhaseForm[];
  tournamentPlayerCapacity: string;
  tournamentStartDateTime: string;
  tournaments: Tournament[] | undefined;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {selectedOrganizationName ?? "Admin workspace"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            Tournaments
          </h1>
        </div>
        <CreateTournamentDialog
          busy={busy}
          onAddTournamentPhase={onAddTournamentPhase}
          onCreateTournament={onCreateTournament}
          onOpenChange={onCreateTournamentOpenChange}
          onRemoveTournamentPhase={onRemoveTournamentPhase}
          onTournamentIsTestEventChange={onTournamentIsTestEventChange}
          onTournamentNameChange={onTournamentNameChange}
          onTournamentPhasesChange={onTournamentPhasesChange}
          onTournamentPlayerCapacityChange={onTournamentPlayerCapacityChange}
          onTournamentStartDateTimeChange={onTournamentStartDateTimeChange}
          open={createTournamentOpen}
          selectedOrganizationId={selectedOrganizationId}
          tournamentName={tournamentName}
          tournamentIsTestEvent={tournamentIsTestEvent}
          tournamentPhases={tournamentPhases}
          tournamentPlayerCapacity={tournamentPlayerCapacity}
          tournamentStartDateTime={tournamentStartDateTime}
        />
      </div>

      <TournamentTable tournaments={tournaments} />
    </section>
  );
}
