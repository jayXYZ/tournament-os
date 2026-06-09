import type { ReactNode } from "react";
import { cookies } from "next/headers";

import { AdminWorkspaceShell } from "@/app/components/organizer-workspace/admin-workspace-shell";

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const defaultSidebarOpen =
    cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <AdminWorkspaceShell defaultSidebarOpen={defaultSidebarOpen}>
      {children}
    </AdminWorkspaceShell>
  );
}
