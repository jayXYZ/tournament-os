import { createFileRoute } from '@tanstack/react-router'
import { PlayerController } from '@/components/player-controller/player-controller'

export const Route = createFileRoute('/tournaments/$tournamentId/play')({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId: publicCode } = Route.useParams()
  // Keyed so per-tournament UI state (selected tab, visited-tab panel
  // mounts and their subscriptions) resets when navigating between
  // different tournaments' play pages.
  return <PlayerController key={publicCode} publicCode={publicCode} />
}
