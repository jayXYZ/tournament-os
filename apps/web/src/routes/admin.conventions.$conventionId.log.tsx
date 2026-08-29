import { createFileRoute } from '@tanstack/react-router'
import { useManagedConvention } from '@/components/organizer-workspace/convention-manager/convention-manager-context'
import { ConventionAuditLogView } from '@/components/organizer-workspace/convention-manager/convention-audit-log-view'

export const Route = createFileRoute('/admin/conventions/$conventionId/log')({
  component: RouteComponent,
})

function RouteComponent() {
  const { conventionId } = useManagedConvention()
  return <ConventionAuditLogView conventionId={conventionId} />
}
