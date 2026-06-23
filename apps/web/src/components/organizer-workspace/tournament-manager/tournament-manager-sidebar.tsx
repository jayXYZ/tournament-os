import { Link, useLocation } from '@tanstack/react-router'
import {
  ClipboardList,
  LayoutDashboard,
  Swords,
  Trophy,
} from 'lucide-react'

import { cn } from '@/lib/utils'

type NavItem = {
  label: string
  href: string
  icon: typeof ClipboardList
}

export function TournamentManagerSidebar({
  tournamentId,
}: {
  tournamentId: string
}) {
  const pathname = useLocation().pathname
  const base = `/admin/tournaments/${tournamentId}`
  const items: Array<NavItem> = [
    {
      label: 'Overview',
      href: base,
      icon: LayoutDashboard,
    },
    {
      label: 'Registrations',
      href: `${base}/registrations`,
      icon: ClipboardList,
    },
    {
      label: 'Pairings',
      href: `${base}/pairings`,
      icon: Swords,
    },
    {
      label: 'Standings',
      href: `${base}/standings`,
      icon: Trophy,
    },
  ]

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground md:flex">
      <nav className="flex flex-col gap-px p-2">
        {items.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              to={item.href}
              data-active={isActive}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-2 text-sm text-sidebar-foreground transition-colors',
                'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                'data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
