import { createFileRoute } from '@tanstack/react-router'
import { ConventionOverviewView } from '@/components/organizer-workspace/convention-manager/convention-overview-view'

export const Route = createFileRoute('/admin/conventions/$conventionId/')({
  component: ConventionOverviewView,
})
