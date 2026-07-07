import { createFileRoute } from '@tanstack/react-router'
import { useManagedTournament } from '@/components/organizer-workspace/tournament-manager/tournament-manager-context'
import { PairingsView } from '@/components/organizer-workspace/tournament-manager/pairings-view'
import { parseRoundSelectionSearch } from '@/components/tournaments'

export const Route = createFileRoute(
  '/admin/tournaments/$tournamentId/pairings',
)({
  validateSearch: parseRoundSelectionSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = useManagedTournament()
  const roundSelection = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <PairingsView
      tournamentId={tournamentId}
      roundSelection={roundSelection}
      onRoundSelectionChange={(selection) =>
        void navigate({ search: selection, replace: true })
      }
    />
  )
}
