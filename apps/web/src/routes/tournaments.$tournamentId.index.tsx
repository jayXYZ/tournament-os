import { createFileRoute } from '@tanstack/react-router'
import { TournamentPublicPage } from '@/components/tournament-public-page'

export const Route = createFileRoute('/tournaments/$tournamentId/')({
  // The invite search param carries a private event's join code from a
  // /join/<code> link through sign-in redirects and refreshes; the page
  // passes it along to the event query and registration mutation. Anything
  // non-string is dropped rather than rejected — the page then just behaves
  // as if no invite were presented.
  validateSearch: (search: Record<string, unknown>): { invite?: string } => ({
    invite: typeof search.invite === 'string' ? search.invite : undefined,
  }),
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId: publicCode } = Route.useParams()
  const { invite } = Route.useSearch()
  return <TournamentPublicPage publicCode={publicCode} inviteCode={invite} />
}
