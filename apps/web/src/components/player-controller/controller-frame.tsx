import { Swords } from 'lucide-react'
import type { ReactNode } from 'react'

import { PublicSiteHeader } from '@/components/shared/public-site-header'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

const contentWidthClasses = {
  '4xl': 'lg:max-w-4xl',
  '6xl': 'lg:max-w-6xl',
} as const

// Responsive shell for the player-facing tournament pages. On phones it reads
// like the native app: a compact sticky app bar carrying the page's live
// status above a single column of cards. From `lg` up it swaps to the site's
// standard chrome — the shared site header over a centered content column —
// so the page matches the rest of the website.
export function ControllerFrame({
  subtitle,
  actions,
  mobileHeader,
  width = '4xl',
  contentClassName,
  children,
}: {
  subtitle: string
  actions?: ReactNode
  mobileHeader?: ReactNode
  width?: keyof typeof contentWidthClasses
  contentClassName?: string
  children: ReactNode
}) {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background lg:hidden">
        <div className="mx-auto max-w-md px-4 py-3 sm:max-w-2xl sm:px-6">
          {mobileHeader ?? (
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Swords className="size-4" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold">{subtitle}</p>
            </div>
          )}
        </div>
      </header>
      <div className="hidden lg:block">
        <PublicSiteHeader maxWidth={width} subtitle={subtitle} actions={actions} />
      </div>
      <div
        className={cn(
          'mx-auto w-full max-w-md px-4 pb-24 sm:max-w-2xl sm:px-6 lg:px-8 lg:pb-16',
          contentWidthClasses[width],
          contentClassName,
        )}
      >
        {children}
      </div>
      <Toaster />
    </main>
  )
}
