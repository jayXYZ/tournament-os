import { createLink } from '@tanstack/react-router'
import { ArrowLeft, Swords } from 'lucide-react'
import type { ComponentPropsWithRef, ReactNode } from 'react'

import {
  PublicSiteHeader,
  maxWidthClasses,
} from '@/components/shared/public-site-header'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

// The app-chrome content column keeps app widths below `lg`, so it needs the
// `lg:` variant of each header width class. The mapped type pins every value
// to exactly `lg:` + the header's class, so this map can never drift from
// `maxWidthClasses` (Tailwind needs the strings spelled out literally).
const lgMaxWidthClasses: {
  [Width in keyof typeof maxWidthClasses]: `lg:${(typeof maxWidthClasses)[Width]}`
} = {
  '4xl': 'lg:max-w-4xl',
  '6xl': 'lg:max-w-6xl',
  '7xl': 'lg:max-w-7xl',
}

// Shared shell for the player-facing pages: the public site header over a
// centered content column, with the page-level Toaster.
//
// Pages that read like the native app on phones (the player controller
// surfaces) pass `appBar`: below `lg` the site header gives way to a compact
// sticky app bar carrying the page's live status, and the content column
// tightens to app widths above a single column of cards. From `lg` up the
// site's standard chrome returns, so the page matches the rest of the website.
export function SiteShell({
  subtitle,
  actions,
  width = '4xl',
  appBar,
  contentClassName,
  toaster = false,
  children,
}: {
  subtitle: string
  actions?: ReactNode
  width?: keyof typeof maxWidthClasses
  // Content for the phone app bar; pass `true` for the default brand row.
  // Omit it entirely to keep the site header at every viewport.
  appBar?: ReactNode
  contentClassName?: string
  toaster?: boolean
  children: ReactNode
}) {
  const siteHeader = (
    <PublicSiteHeader maxWidth={width} subtitle={subtitle} actions={actions} />
  )

  return (
    <main className="min-h-svh bg-background text-foreground">
      {appBar ? (
        <>
          <header className="sticky top-0 z-10 border-b border-border bg-background lg:hidden">
            <div className="mx-auto max-w-md px-4 py-3 sm:max-w-2xl sm:px-6">
              {appBar === true ? (
                <div className="flex items-center gap-3">
                  <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <Swords className="size-4" aria-hidden="true" />
                  </div>
                  <p className="text-sm font-semibold">{subtitle}</p>
                </div>
              ) : (
                appBar
              )}
            </div>
          </header>
          <div className="hidden lg:block">{siteHeader}</div>
          <div
            className={cn(
              'mx-auto w-full max-w-md px-4 pb-24 sm:max-w-2xl sm:px-6 lg:px-8 lg:pb-16',
              lgMaxWidthClasses[width],
              contentClassName,
            )}
          >
            {children}
          </div>
        </>
      ) : (
        <>
          {siteHeader}
          <section
            className={cn(
              'mx-auto grid gap-6 px-4 py-8 sm:px-6 lg:px-8',
              maxWidthClasses[width],
              contentClassName,
            )}
          >
            {children}
          </section>
        </>
      )}
      {toaster ? <Toaster /> : null}
    </main>
  )
}

function BackLinkAnchor({ children, ...props }: ComponentPropsWithRef<'a'>) {
  return (
    <Button asChild variant="ghost">
      <a {...props}>
        <ArrowLeft data-icon="inline-start" />
        {children}
      </a>
    </Button>
  )
}

// The ghost back-navigation link every page puts in the site header's
// `actions` slot, so the ArrowLeft markup exists once. A full router Link via
// createLink, so `to`/`params` stay typed at the call site.
export const SiteShellBackLink = createLink(BackLinkAnchor)
