import { createFileRoute } from '@tanstack/react-router'
import { useManagedTournament } from '@/components/organizer-workspace/tournament-manager/tournament-manager-context'
import { RegistrationsView } from '@/components/organizer-workspace/tournament-manager/registrations-view'

export const Route = createFileRoute(
  '/admin/tournaments/$tournamentId/registrations',
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = useManagedTournament()
  return <RegistrationsView tournamentId={tournamentId} />
}
