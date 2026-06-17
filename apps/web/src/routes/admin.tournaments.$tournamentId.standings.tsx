import { createFileRoute } from '@tanstack/react-router'
import { StandingsView } from '@/components/organizer-workspace/tournament-manager/standings-view'

export const Route = createFileRoute(
  '/admin/tournaments/$tournamentId/standings',
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = Route.useParams()
  return <StandingsView tournamentId={tournamentId} />
}
