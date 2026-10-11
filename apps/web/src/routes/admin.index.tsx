import { createFileRoute } from '@tanstack/react-router'
import { AdminViewsLayout } from '@/components/organizer-workspace/admin-views-layout'
import { TournamentAdminView } from '@/components/organizer-workspace/tournament-admin-view'
import { parseTournamentTableSearch } from '@/components/tournaments'

export const Route = createFileRoute('/admin/')({
  // The table's search and filter chips live in the URL.
  validateSearch: parseTournamentTableSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <AdminViewsLayout>
      <TournamentAdminView
        search={search}
        onSearchChange={(next) =>
          void navigate({ search: next, replace: true })
        }
      />
    </AdminViewsLayout>
  )
}
