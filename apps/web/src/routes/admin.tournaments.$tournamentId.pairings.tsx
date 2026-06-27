import { createFileRoute } from '@tanstack/react-router'
import { useManagedTournament } from '@/components/organizer-workspace/tournament-manager/tournament-manager-context'
import { PairingsView } from '@/components/organizer-workspace/tournament-manager/pairings-view'

export const Route = createFileRoute(
  '/admin/tournaments/$tournamentId/pairings',
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = useManagedTournament()
  return <PairingsView tournamentId={tournamentId} />
}
