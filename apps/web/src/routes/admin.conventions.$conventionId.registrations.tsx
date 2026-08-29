import { createFileRoute } from '@tanstack/react-router'
import { useManagedConvention } from '@/components/organizer-workspace/convention-manager/convention-manager-context'
import { BadgeRosterView } from '@/components/organizer-workspace/convention-manager/badge-roster-view'

export const Route = createFileRoute(
  '/admin/conventions/$conventionId/registrations',
)({
  component: RouteComponent,
})

function RouteComponent() {
  const { conventionId } = useManagedConvention()
  return <BadgeRosterView conventionId={conventionId} />
}
