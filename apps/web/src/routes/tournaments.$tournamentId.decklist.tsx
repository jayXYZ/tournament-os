import { createFileRoute } from '@tanstack/react-router'
import { DecklistPage } from '@/components/player-controller/decklist/decklist-page'

export const Route = createFileRoute('/tournaments/$tournamentId/decklist')({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId: publicCode } = Route.useParams()
  return <DecklistPage publicCode={publicCode} />
}
