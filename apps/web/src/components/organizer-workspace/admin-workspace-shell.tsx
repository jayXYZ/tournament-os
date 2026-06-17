
import { useEffect, type ReactNode } from "react";
import { useMutation } from "convex/react";

import { api } from "@tournament-os/backend/convex/_generated/api";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminAuthGate } from "./admin-auth-gate";
import { AdminHeader, AdminSidebar } from "./admin-sidebar";
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
          <SidebarProvider defaultOpen={defaultSidebarOpen}>
            <UpsertCurrentUser />
            <AdminSidebar />
            <SidebarInset>
              <AdminHeader />
              {children}
            </SidebarInset>
            <Toaster />
          </SidebarProvider>
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
