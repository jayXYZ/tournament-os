"use client";

import { useEffect } from "react";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminHeader, AdminSidebar } from "./organizer-workspace/admin-sidebar";
import { OrganizationProvider } from "./organizer-workspace/organization-context";
import { OrganizationProfileView } from "./organizer-workspace/organization-profile-view";
import {
  NoticeProvider,
  WorkspaceNotice,
} from "./organizer-workspace/notice-context";
import { StaffView } from "./organizer-workspace/staff-view";
import { TournamentAdminView } from "./organizer-workspace/tournament-admin-view";
import type { AdminView } from "./organizer-workspace/types";

export function OrganizerWorkspace({ view }: { view: AdminView }) {
  const upsertMe = useMutation(api.users.upsertMe);

  useEffect(() => {
    void upsertMe();
  }, [upsertMe]);

  return (
    <TooltipProvider>
      <OrganizationProvider>
        <NoticeProvider>
          <SidebarProvider>
            <AdminSidebar view={view} />
            <SidebarInset>
              <AdminHeader />

              <div className="p-4 sm:p-6 lg:p-8">
                <div className="mx-auto grid max-w-6xl gap-6">
                  <WorkspaceNotice />

                  {view === "staff" ? (
                    <StaffView />
                  ) : view === "organization" ? (
                    <OrganizationProfileView />
                  ) : (
                    <TournamentAdminView />
                  )}
                </div>
              </div>
            </SidebarInset>
          </SidebarProvider>
        </NoticeProvider>
      </OrganizationProvider>
    </TooltipProvider>
  );
}
