import { Outlet, createFileRoute } from '@tanstack/react-router'
import { AdminWorkspaceShell } from '@/components/organizer-workspace/admin-workspace-shell'

export const Route = createFileRoute('/admin')({
  component: AdminLayout,
})

function AdminLayout() {
  return (
    <AdminWorkspaceShell defaultSidebarOpen={true}>
      <Outlet />
    </AdminWorkspaceShell>
  )
}
