import { createFileRoute } from '@tanstack/react-router'
import { PlayerSettingsPage } from '@/components/settings/player-settings-page'

export const Route = createFileRoute('/settings')({
  component: PlayerSettingsPage,
})
