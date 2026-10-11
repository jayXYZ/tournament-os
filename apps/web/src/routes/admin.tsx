import { Outlet, createFileRoute } from '@tanstack/react-router'
import { createIsomorphicFn } from '@tanstack/react-start'
import { getCookie } from '@tanstack/react-start/server'
import { AdminWorkspaceShell } from '@/components/organizer-workspace/admin-workspace-shell'
import { SIDEBAR_COOKIE_NAME, readSidebarCookie } from '@/components/ui/sidebar'
import { readCookie } from '@/lib/cookies'

// The sidebar's remembered open state. On the server it comes from the
// request cookie so the server-rendered markup and the hydrating client agree
// on the first paint (reading `document.cookie` in the provider instead would
// make the client disagree with the SSR output, and React does not patch
// mismatched attributes on hydration). On the client it comes straight from
// `document.cookie`, so re-entering the workspace after a toggle picks up the
// saved preference without a server round trip.
const readSidebarOpen = createIsomorphicFn()
  .server(() => readSidebarCookie(getCookie(SIDEBAR_COOKIE_NAME)))
  .client(() =>
    readSidebarCookie(readCookie(document.cookie, SIDEBAR_COOKIE_NAME)),
  )

export const Route = createFileRoute('/admin')({
  // Runs again whenever the layout is matched, including re-entry through
  // history after the shell unmounted. That is what keeps the remounted
  // provider in step with the cookie; while the shell stays mounted the
  // provider keeps its own state and the re-read is a free client-side parse.
  loader: () => ({ sidebarOpen: readSidebarOpen() }),
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
