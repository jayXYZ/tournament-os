import { Outlet, createFileRoute, useLocation } from '@tanstack/react-router'
import { AdminWorkspaceShell } from '@/components/organizer-workspace/admin-workspace-shell'

export const Route = createFileRoute('/admin')({
  component: AdminLayout,
})

const tournamentManagerPath = /^\/admin\/tournaments\/[^/]+/

function AdminLayout() {
  const pathname = useLocation().pathname
  return (
    <AdminWorkspaceShell collapseSidebar={tournamentManagerPath.test(pathname)}>
      <Outlet />
    </AdminWorkspaceShell>
  )
}
