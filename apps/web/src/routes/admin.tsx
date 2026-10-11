import { Outlet, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { AdminWorkspaceShell } from '@/components/organizer-workspace/admin-workspace-shell'
import { SIDEBAR_COOKIE_NAME, readSidebarCookie } from '@/components/ui/sidebar'

// The sidebar's remembered open state, read from the request cookie on the
// server so the server-rendered markup and the hydrating client agree on the
// first paint. Reading `document.cookie` in the provider instead would make
// the client disagree with the SSR output, and React does not patch mismatched
// attributes on hydration.
const fetchSidebarOpen = createServerFn({ method: 'GET' }).handler(() =>
  readSidebarCookie(getCookie(SIDEBAR_COOKIE_NAME)),
)

export const Route = createFileRoute('/admin')({
  loader: async () => ({ sidebarOpen: await fetchSidebarOpen() }),
  // Only the first paint reads this; the provider keeps its own state from
  // then on, so a client-side navigation inside the workspace never needs to
  // ask the server again.
  staleTime: Infinity,
  component: AdminLayout,
})

function AdminLayout() {
  const { sidebarOpen } = Route.useLoaderData()
  return (
    <AdminWorkspaceShell defaultSidebarOpen={sidebarOpen}>
      <Outlet />
    </AdminWorkspaceShell>
  )
}
