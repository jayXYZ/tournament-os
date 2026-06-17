import { createFileRoute } from '@tanstack/react-router'
import { TournamentOverviewView } from '@/components/organizer-workspace/tournament-manager/tournament-overview-view'

export const Route = createFileRoute('/admin/tournaments/$tournamentId/')({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = Route.useParams()
  return <TournamentOverviewView tournamentId={tournamentId} />
}
