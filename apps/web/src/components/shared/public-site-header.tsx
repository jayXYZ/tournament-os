import { Swords } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

const maxWidthClasses = {
  '4xl': 'max-w-4xl',
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
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Swords className="size-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-none">Tournament OS</p>
            <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {actions ? (
          <div className="flex items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  )
}
