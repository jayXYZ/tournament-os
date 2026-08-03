import { createFileRoute } from '@tanstack/react-router'
import { DecklistPage } from '@/components/player-controller/decklist/decklist-page'

export const Route = createFileRoute('/tournaments/$tournamentId/decklist')({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId: publicCode } = Route.useParams()
  // Keyed so per-tournament UI state (the editor's dirty flag) resets when
  // navigating between different tournaments' decklist pages.
  return <DecklistPage key={publicCode} publicCode={publicCode} />
}
