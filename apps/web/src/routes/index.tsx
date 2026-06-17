import { createFileRoute } from '@tanstack/react-router'
import { PlayerHome } from '@/components/player-home'

export const Route = createFileRoute('/')({
  component: PlayerHome,
})
