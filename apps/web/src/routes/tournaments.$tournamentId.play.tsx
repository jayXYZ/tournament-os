import { createFileRoute } from '@tanstack/react-router'
import { PlayerController } from '@/components/player-controller/player-controller'

export const Route = createFileRoute('/tournaments/$tournamentId/play')({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = Route.useParams()
  return <PlayerController tournamentId={tournamentId} />
}
