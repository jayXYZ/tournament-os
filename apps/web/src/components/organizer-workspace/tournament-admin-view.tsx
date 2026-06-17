
import { useQuery } from "convex/react";

import { api } from "@tournament-os/backend/convex/_generated/api";
import { CreateTournamentDialog } from "./create-tournament-dialog";
import { useOrganization } from "./organization-context";
import { TournamentTable } from "./tournament-table";

export function TournamentAdminView() {
  const { selectedOrganizationId, selectedOrganization } = useOrganization();
  const tournaments = useQuery(
    api.tournaments.lifecycle.listUpcomingForOrganization,
    selectedOrganizationId ? { organizationId: selectedOrganizationId } : "skip",
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {selectedOrganization?.organization.name ?? "Admin workspace"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            Tournaments
          </h1>
        </div>
        <CreateTournamentDialog />
      </div>

      <TournamentTable tournaments={tournaments} />
    </section>
  );
}
