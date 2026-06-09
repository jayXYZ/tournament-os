"use client";

import { use } from "react";

import { AdminAuthGate } from "@/app/components/organizer-workspace/admin-auth-gate";
import { TournamentManagerWorkspace } from "@/app/components/organizer-workspace/tournament-manager/tournament-manager-workspace";

export default function TournamentPairingsPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = use(params);

  return (
    <AdminAuthGate description="Manage registrations, pairings, and standings for this tournament from the admin workspace.">
      <TournamentManagerWorkspace tournamentId={tournamentId} view="pairings" />
    </AdminAuthGate>
  );
}
