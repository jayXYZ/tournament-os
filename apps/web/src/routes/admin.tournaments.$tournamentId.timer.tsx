import { createFileRoute } from '@tanstack/react-router'
import { useManagedTournament } from '@/components/organizer-workspace/tournament-manager/tournament-manager-context'
import { RoundTimerView } from '@/components/organizer-workspace/tournament-manager/round-timer-view'

export const Route = createFileRoute('/admin/tournaments/$tournamentId/timer')({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = useManagedTournament()
  return <RoundTimerView tournamentId={tournamentId} />
}
