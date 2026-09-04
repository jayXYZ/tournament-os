import { createFileRoute } from '@tanstack/react-router'
import { ConventionSettingsView } from '@/components/organizer-workspace/convention-manager/settings/convention-settings-view'

export const Route = createFileRoute(
  '/admin/conventions/$conventionId/settings',
)({
  component: ConventionSettingsView,
})
