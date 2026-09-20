import type { ReactNode } from 'react'

import { ModeToggle } from '@/components/mode-toggle'
import { BrandMark } from '@/components/shared/brand-mark'
import { pageColumnClasses } from '@/components/shared/page-column'
import { cn } from '@/lib/utils'

export function PublicSiteHeader({
  actions,
  subtitle,
}: {
  actions?: ReactNode
  subtitle: string
}) {
  return (
    <header className="border-b border-border bg-background">
      <div
        className={cn(
          pageColumnClasses,
          'flex min-h-16 items-center justify-between gap-3',
        )}
      >
        <div className="flex items-center gap-3">
          <BrandMark className="size-9" />
          <div>
            <p className="text-sm font-semibold leading-none">Paper Pairings</p>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <ModeToggle />
        </div>
      </div>
    </header>
  )
}
