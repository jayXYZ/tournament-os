"use client";

import { useEffect } from "react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminHeader, AdminSidebar } from "../admin-sidebar";
import { OrganizationProvider } from "../organization-context";
import { NoticeProvider, WorkspaceNotice } from "../notice-context";
import { getStoredSidebarOpen } from "../sidebar-state";
import type { TournamentManagerView } from "../types";
import { PairingsView } from "./pairings-view";
import { RegistrationsView } from "./registrations-view";
import { StandingsView } from "./standings-view";
import { TournamentManagerSidebar } from "./tournament-manager-sidebar";

export function TournamentManagerWorkspace({
  tournamentId,
  view,
}: {
  tournamentId: string;
  view: TournamentManagerView;
}) {
  const upsertMe = useMutation(api.users.upsertMe);

  useEffect(() => {
    void upsertMe();
  }, [upsertMe]);

  return (
    <TooltipProvider>
      <OrganizationProvider>
        <NoticeProvider>
          <SidebarProvider defaultOpen={getStoredSidebarOpen()}>
            <AdminSidebar view="tournaments" />
            <SidebarInset>
              <AdminHeader />

              <div className="flex min-h-0 flex-1">
                <ManagerSidebar tournamentId={tournamentId} view={view} />

                <div className="min-w-0 flex-1 overflow-auto">
                  <div className="p-4 sm:p-6 lg:p-8">
                    <div className="mx-auto grid max-w-6xl gap-6">
                      <WorkspaceNotice />
                      <ManagerContent tournamentId={tournamentId} view={view} />
                    </div>
                  </div>
                </div>
              </div>
            </SidebarInset>
          </SidebarProvider>
        </NoticeProvider>
      </OrganizationProvider>
    </TooltipProvider>
  );
}

function ManagerSidebar({
  tournamentId,
  view,
}: {
  tournamentId: string;
  view: TournamentManagerView;
}) {
  const setup = useQuery(api.tournaments.getTournamentSetup, {
    tournamentId: tournamentId as Id<"tournaments">,
  });

  return (
    <TournamentManagerSidebar
      tournamentId={tournamentId}
      tournament={setup?.tournament}
      view={view}
    />
  );
}

function ManagerContent({
  tournamentId,
  view,
}: {
  tournamentId: string;
  view: TournamentManagerView;
}) {
  if (view === "pairings") {
    return <PairingsView tournamentId={tournamentId} />;
  }
  if (view === "standings") {
    return <StandingsView tournamentId={tournamentId} />;
  }
  return <RegistrationsView tournamentId={tournamentId} />;
}
