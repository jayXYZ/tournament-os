import {
  ClipboardList,
  LayoutDashboard,
  Settings,
  Swords,
  Trophy,
} from 'lucide-react'

import type { WorkspaceSubnavItem } from '@/components/shared/workspace-subnav'
import { WorkspaceSubnav } from '@/components/shared/workspace-subnav'

export function TournamentManagerSubnav({
  publicCode,
}: {
  publicCode: string
}) {
  const base = `/admin/tournaments/${publicCode}`
  const items: Array<WorkspaceSubnavItem> = [
    { label: 'Overview', href: base, icon: LayoutDashboard },
    {
      label: 'Registrations',
      href: `${base}/registrations`,
      icon: ClipboardList,
    },
    { label: 'Pairings', href: `${base}/pairings`, icon: Swords },
    { label: 'Standings', href: `${base}/standings`, icon: Trophy },
    { label: 'Settings', href: `${base}/settings`, icon: Settings },
  ]

  return <WorkspaceSubnav aria-label="Tournament sections" items={items} />
}
