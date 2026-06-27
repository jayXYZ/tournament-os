import { createFileRoute } from '@tanstack/react-router'
import { useManagedTournament } from '@/components/organizer-workspace/tournament-manager/tournament-manager-context'
import { TournamentOverviewView } from '@/components/organizer-workspace/tournament-manager/tournament-overview-view'

export const Route = createFileRoute('/admin/tournaments/$tournamentId/')({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = useManagedTournament()
  return <TournamentOverviewView tournamentId={tournamentId} />
}
