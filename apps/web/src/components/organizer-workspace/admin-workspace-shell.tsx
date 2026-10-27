import { AdminAuthGate } from './admin-auth-gate'
import { AdminHeader, AdminSidebar } from './admin-sidebar'
import { OrganizationProvider } from './organization-context'
import type { ReactNode } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

export function AdminWorkspaceShell({
  children,
  defaultSidebarOpen,
}: {
  children: ReactNode
  // The cookie-remembered open state, read on the server by the admin route
  // so the first paint matches between SSR and hydration. Undefined means no
  // toggle has been recorded yet, and the sidebar starts expanded.
  defaultSidebarOpen?: boolean
}) {
  return (
    <AdminAuthGate>
      <TooltipProvider>
        <OrganizationProvider>
          <SidebarProvider defaultOpen={defaultSidebarOpen}>
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
