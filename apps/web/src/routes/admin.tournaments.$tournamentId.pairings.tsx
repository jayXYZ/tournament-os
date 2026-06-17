import { createFileRoute } from '@tanstack/react-router'
import { PairingsView } from '@/components/organizer-workspace/tournament-manager/pairings-view'

export const Route = createFileRoute('/admin/tournaments/$tournamentId/pairings')({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = Route.useParams()
  return <PairingsView tournamentId={tournamentId} />
}
