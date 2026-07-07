import { createFileRoute } from '@tanstack/react-router'
import { useManagedTournament } from '@/components/organizer-workspace/tournament-manager/tournament-manager-context'
import { StandingsView } from '@/components/organizer-workspace/tournament-manager/standings-view'
import { parseRoundSelectionSearch } from '@/components/tournaments'

export const Route = createFileRoute(
  '/admin/tournaments/$tournamentId/standings',
)({
  validateSearch: parseRoundSelectionSearch,
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = useManagedTournament()
  const roundSelection = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <StandingsView
      tournamentId={tournamentId}
      roundSelection={roundSelection}
      onRoundSelectionChange={(selection) =>
        void navigate({ search: selection, replace: true })
      }
    />
  )
}
