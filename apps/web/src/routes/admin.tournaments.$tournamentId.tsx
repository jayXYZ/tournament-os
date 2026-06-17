import { Outlet, createFileRoute } from '@tanstack/react-router'
import { TournamentManagerSidebar } from '@/components/organizer-workspace/tournament-manager/tournament-manager-sidebar'

export const Route = createFileRoute('/admin/tournaments/$tournamentId')({
  component: TournamentManagerLayout,
})

function TournamentManagerLayout() {
  const { tournamentId } = Route.useParams()

  return (
    <div className="flex min-h-0 flex-1">
      <TournamentManagerSidebar tournamentId={tournamentId} />

      <div className="min-w-0 flex-1 overflow-auto">
        <div className="p-4 sm:p-6 lg:p-8">
          <div className="mx-auto grid max-w-6xl gap-6">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}
