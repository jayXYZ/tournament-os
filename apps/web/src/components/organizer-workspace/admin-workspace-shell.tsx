import { AdminAuthGate } from './admin-auth-gate'
import { AdminHeader, AdminSidebar } from './admin-sidebar'
import { OrganizationProvider } from './organization-context'
import type { ReactNode } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useEnsureUserRow } from '@/hooks/use-ensure-user-row'

export function AdminWorkspaceShell({
  defaultSidebarOpen,
  children,
}: {
  defaultSidebarOpen: boolean
  children: ReactNode
}) {
  return (
    <AdminAuthGate>
      <TooltipProvider>
        <OrganizationProvider>
          <SidebarProvider defaultOpen={defaultSidebarOpen}>
            <UpsertCurrentUser />
            <AdminSidebar />
            <SidebarInset className="h-svh overflow-hidden md:peer-data-[variant=inset]:h-[calc(100svh-1rem)]">
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
