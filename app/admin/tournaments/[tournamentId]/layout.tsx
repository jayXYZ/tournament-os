import type { ReactNode } from "react";

import { TournamentManagerSidebar } from "@/app/components/organizer-workspace/tournament-manager/tournament-manager-sidebar";

export default async function TournamentManagerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;

  return (
    <div className="flex min-h-0 flex-1">
      <TournamentManagerSidebar tournamentId={tournamentId} />

      <div className="min-w-0 flex-1 overflow-auto">
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="mx-auto grid max-w-6xl gap-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
