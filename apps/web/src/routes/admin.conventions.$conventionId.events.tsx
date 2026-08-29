import { createFileRoute } from '@tanstack/react-router'
import { ConventionEventsView } from '@/components/organizer-workspace/convention-manager/convention-events-view'

export const Route = createFileRoute('/admin/conventions/$conventionId/events')(
  {
    component: ConventionEventsView,
  },
)
