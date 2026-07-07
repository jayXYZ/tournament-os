import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { AdminViewsLayout } from '@/components/organizer-workspace/admin-views-layout'
import { ManagedTournamentProvider } from '@/components/organizer-workspace/tournament-manager/tournament-manager-context'
import { TournamentManagerSubnav } from '@/components/organizer-workspace/tournament-manager/tournament-manager-subnav'
import { TournamentProgressBar } from '@/components/organizer-workspace/tournament-manager/tournament-progress-bar'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/admin/tournaments/$tournamentId')({
  component: TournamentManagerLayout,
})

function TournamentManagerLayout() {
  // The URL param is the public tournament code, not the Convex id.
  const { tournamentId: publicCode } = Route.useParams()
  const managed = useQuery(api.tournaments.lifecycle.getManagedTournament, {
    publicCode,
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TournamentManagerSubnav publicCode={publicCode} />

      {managed ? (
        <TournamentProgressBar
          tournamentId={managed.tournament._id}
          publicCode={publicCode}
        />
      ) : null}

      <AdminViewsLayout>
        {managed === undefined ? (
          <Skeleton className="h-72" />
        ) : managed === null ? (
          <p className="text-sm text-muted-foreground">Tournament not found.</p>
        ) : (
          <ManagedTournamentProvider
            value={{ publicCode, tournamentId: managed.tournament._id }}
          >
            <Outlet />
          </ManagedTournamentProvider>
        )}
      </AdminViewsLayout>
    </div>
  )
}
