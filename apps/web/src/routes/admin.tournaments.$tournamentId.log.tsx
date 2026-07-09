import { createFileRoute } from '@tanstack/react-router'
import { useManagedTournament } from '@/components/organizer-workspace/tournament-manager/tournament-manager-context'
import { AuditLogView } from '@/components/organizer-workspace/tournament-manager/audit-log-view'

export const Route = createFileRoute('/admin/tournaments/$tournamentId/log')({
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId } = useManagedTournament()
  return <AuditLogView tournamentId={tournamentId} />
}
