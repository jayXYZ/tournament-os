import { createFileRoute } from '@tanstack/react-router'
import { useManagedTournament } from '@/components/organizer-workspace/tournament-manager/tournament-manager-context'
import { TournamentSettingsView } from '@/components/organizer-workspace/tournament-manager/tournament-settings-view'

export const Route = createFileRoute('/admin/tournaments/$tournamentId/settings')({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = useManagedTournament()
  return <TournamentSettingsView tournamentId={tournamentId} />
}
