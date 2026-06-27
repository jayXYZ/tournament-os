import { Link, useLocation } from '@tanstack/react-router'

import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

export type WorkspaceSubnavItem = {
  label: string
  href: string
  icon: LucideIcon
}

// A context-aware section bar that replaces a nested sidebar: a horizontal row
// of underline tabs sitting just beneath the workspace header. The active tab's
// 2px underline overlaps the bar's bottom border for a crisp seam.
export function WorkspaceSubnav({
  items,
  'aria-label': ariaLabel = 'Section',
}: {
  items: Array<WorkspaceSubnavItem>
  'aria-label'?: string
}) {
  const pathname = useLocation().pathname

  return (
    // The wrapper clips the bar so it appears to lower out from beneath the
    // workspace header rather than slide over it. Only animates on mount (route
    // entry), not on tab switches within the section.
    <div className="sticky top-14 z-20 shrink-0 overflow-hidden">
      <nav
        aria-label={ariaLabel}
        className="border-b border-border bg-background duration-300 ease-out animate-in slide-in-from-top motion-reduce:animate-none"
      >
        <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
        {items.map((item) => {
          const Icon = item.icon
          const isActive = pathname === item.href
          return (
            <Link
              key={item.href}
              to={item.href}
              data-active={isActive}
              className={cn(
                'relative flex items-center gap-2 whitespace-nowrap rounded-sm border-b-2 border-transparent px-2 py-3 text-sm font-medium text-muted-foreground transition-colors -mb-px',
                'hover:text-foreground',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'data-[active=true]:border-foreground data-[active=true]:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          )
        })}
        </div>
      </nav>
    </div>
  )
}
