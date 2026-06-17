import { createFileRoute } from '@tanstack/react-router'
import { RegistrationsView } from '@/components/organizer-workspace/tournament-manager/registrations-view'

export const Route = createFileRoute(
  '/admin/tournaments/$tournamentId/registrations',
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = Route.useParams()
  return <RegistrationsView tournamentId={tournamentId} />
}
