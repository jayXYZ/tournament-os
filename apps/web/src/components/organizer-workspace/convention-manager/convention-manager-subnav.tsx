import {
  ClipboardList,
  LayoutDashboard,
  ScrollText,
  Settings,
  Trophy,
} from 'lucide-react'

import type { WorkspaceSubnavItem } from '@/components/shared/workspace-subnav'
import { WorkspaceSubnav } from '@/components/shared/workspace-subnav'

export function ConventionManagerSubnav({
  publicCode,
}: {
  publicCode: string
}) {
  const base = `/admin/conventions/${publicCode}`
  const items: Array<WorkspaceSubnavItem> = [
    { label: 'Overview', href: base, icon: LayoutDashboard },
    {
      label: 'Registrations',
      href: `${base}/registrations`,
      icon: ClipboardList,
    },
    { label: 'Events', href: `${base}/events`, icon: Trophy },
    { label: 'Log', href: `${base}/log`, icon: ScrollText },
    { label: 'Settings', href: `${base}/settings`, icon: Settings },
  ]

  return <WorkspaceSubnav aria-label="Convention sections" items={items} />
}
