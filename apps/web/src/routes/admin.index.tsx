import { createFileRoute } from '@tanstack/react-router'
import { AdminViewsLayout } from '@/components/organizer-workspace/admin-views-layout'
import { TournamentAdminView } from '@/components/organizer-workspace/tournament-admin-view'

export const Route = createFileRoute('/admin/')({
  component: RouteComponent,
})

function RouteComponent() {
  return (
    <AdminViewsLayout>
      <TournamentAdminView />
    </AdminViewsLayout>
  )
}
