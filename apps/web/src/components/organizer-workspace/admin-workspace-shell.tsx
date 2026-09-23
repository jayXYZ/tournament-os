import { AdminAuthGate } from './admin-auth-gate'
import { AdminHeader, AdminSidebar } from './admin-sidebar'
import { OrganizationProvider } from './organization-context'
import type { ReactNode } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useEnsureUserRow } from '@/hooks/use-ensure-user-row'

export function AdminWorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <AdminAuthGate>
      <TooltipProvider>
        <OrganizationProvider>
          <SidebarProvider>
            <UpsertCurrentUser />
            <AdminSidebar />
            <SidebarInset className="h-svh overflow-hidden">
              <AdminHeader />
              <div className="flex min-h-0 flex-1 flex-col">{children}</div>
            </SidebarInset>
            <Toaster />
          </SidebarProvider>
        </OrganizationProvider>
      </TooltipProvider>
    </AdminAuthGate>
  )
}

function UpsertCurrentUser() {
  // Failure is non-blocking here: nothing in the workspace gates on the users
  // row (createOrganization ensures it itself, and organizations.listMine
  // tolerates a missing row), so a rejected upsert only means a stale
  // name/avatar until the next visit — no error UI needed.
  useEnsureUserRow()
  return null
}
