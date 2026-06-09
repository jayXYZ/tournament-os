"use client";

import { useEffect, type ReactNode } from "react";
import { useMutation } from "convex/react";

import { api } from "@/convex/_generated/api";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminAuthGate } from "./admin-auth-gate";
import { AdminHeader, AdminSidebar } from "./admin-sidebar";
import { NoticeProvider } from "./notice-context";
import { OrganizationProvider } from "./organization-context";

export function AdminWorkspaceShell({
  defaultSidebarOpen,
  children,
}: {
  defaultSidebarOpen: boolean;
  children: ReactNode;
}) {
  return (
    <AdminAuthGate>
      <TooltipProvider>
        <OrganizationProvider>
          <NoticeProvider>
            <SidebarProvider defaultOpen={defaultSidebarOpen}>
              <UpsertCurrentUser />
              <AdminSidebar />
              <SidebarInset>
                <AdminHeader />
                {children}
              </SidebarInset>
            </SidebarProvider>
          </NoticeProvider>
        </OrganizationProvider>
      </TooltipProvider>
    </AdminAuthGate>
  );
}

function UpsertCurrentUser() {
  const upsertMe = useMutation(api.users.upsertMe);

  useEffect(() => {
    void upsertMe();
  }, [upsertMe]);

  return null;
}
