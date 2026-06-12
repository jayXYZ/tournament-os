import { convexQuery } from '@convex-dev/react-query'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { api } from '@tournament-os/backend/convex/_generated/api'

export const Route = createFileRoute('/tournaments')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData({
      ...convexQuery(api.tournaments.lifecycle.listUpcomingPublic, {}),
      gcTime: 10000,
    })
  },
  component: TournamentsComponent,
})

function TournamentsComponent() {
  const { data: tournaments } = useSuspenseQuery(
    convexQuery(api.tournaments.lifecycle.listUpcomingPublic, {}),
  )

  return (
    <div className="p-2 flex gap-2 flex-col">
      <h2 className="text-lg font-bold">Upcoming tournaments</h2>
      {tournaments.length === 0 ? (
        <p>No upcoming public tournaments.</p>
      ) : (
        <ul className="list-disc pl-4">
          {tournaments.map((tournament) => (
            <li key={tournament._id}>
              {tournament.name} —{' '}
              {new Date(tournament.startDate).toLocaleDateString()}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
