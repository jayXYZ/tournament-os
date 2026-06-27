import { createFileRoute } from '@tanstack/react-router'
import { useManagedTournament } from '@/components/organizer-workspace/tournament-manager/tournament-manager-context'
import { StandingsView } from '@/components/organizer-workspace/tournament-manager/standings-view'

export const Route = createFileRoute(
  '/admin/tournaments/$tournamentId/standings',
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = useManagedTournament()
  return <StandingsView tournamentId={tournamentId} />
}
