import { createFileRoute } from '@tanstack/react-router'
import { TournamentPublicPage } from '@/components/tournament-public-page'

export const Route = createFileRoute('/tournaments/$tournamentId/')({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId: publicCode } = Route.useParams()
  return <TournamentPublicPage publicCode={publicCode} />
}
