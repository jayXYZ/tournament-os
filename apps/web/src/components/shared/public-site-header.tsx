import type { ReactNode } from 'react'

import { ModeToggle } from '@/components/mode-toggle'
import { BrandMark } from '@/components/shared/brand-mark'
import { cn } from '@/lib/utils'

// Width tokens shared by the header rail and SiteShell's content column, so
// the two can never disagree about what a token means.
export const maxWidthClasses = {
  '4xl': 'max-w-4xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
} as const

export function PublicSiteHeader({
  actions,
  maxWidth = '7xl',
  subtitle,
}: {
  actions?: ReactNode
  maxWidth?: keyof typeof maxWidthClasses
  subtitle: string
}) {
  return (
    <header className="border-b border-border bg-background">
      <div
        className={cn(
          'mx-auto flex min-h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8',
          maxWidthClasses[maxWidth],
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
