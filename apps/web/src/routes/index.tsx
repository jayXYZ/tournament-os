import { createFileRoute } from '@tanstack/react-router'
import { PlayerHome } from '@/components/player-home'
import { parseTournamentTableSearch } from '@/components/tournaments'

export const Route = createFileRoute('/')({
  // The public schedule's search and filter chips live in the URL.
  validateSearch: parseTournamentTableSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <PlayerHome
      scheduleSearch={search}
      onScheduleSearchChange={(next) =>
        void navigate({ search: next, replace: true })
      }
    />
  )
}
