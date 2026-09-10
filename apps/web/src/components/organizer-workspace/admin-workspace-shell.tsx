import { useState } from 'react'

import { AdminAuthGate } from './admin-auth-gate'
import { AdminHeader, AdminSidebar } from './admin-sidebar'
import { OrganizationProvider } from './organization-context'
import type { ReactNode } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useEnsureUserRow } from '@/hooks/use-ensure-user-row'

export function AdminWorkspaceShell({
  collapseSidebar,
  children,
}: {
  // Inside a tournament the three workspace links do not need 16rem while an
  // event is running, so the sidebar defaults to its icon rail there and
  // reopens on the way out. A manual toggle holds until the scope changes.
  collapseSidebar: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(!collapseSidebar)
  const [previousCollapse, setPreviousCollapse] = useState(collapseSidebar)
  if (collapseSidebar !== previousCollapse) {
    setPreviousCollapse(collapseSidebar)
    setOpen(!collapseSidebar)
  }

  return (
    <AdminAuthGate>
      <TooltipProvider>
        <OrganizationProvider>
          <SidebarProvider open={open} onOpenChange={setOpen}>
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
