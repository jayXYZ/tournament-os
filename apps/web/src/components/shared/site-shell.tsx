import { createLink } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import type { ComponentPropsWithRef, ReactNode } from 'react'

import { BrandMark } from '@/components/shared/brand-mark'
import {
  pageColumnClasses,
  readingColumnClasses,
} from '@/components/shared/page-column'
import { PublicSiteHeader } from '@/components/shared/public-site-header'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

// Shared shell for the player-facing pages: the public site header over a
// centered content column, with the page-level Toaster.
//
// Every page renders the same `pageColumnClasses` column for its header rail,
// content and any pinned bars, so nothing shifts sideways when navigating
// between routes. Text-heavy pages pass `readingColumn` to narrow the content
// itself inside that column; the frame never changes width.
//
// Pages that read like the native app on phones (the player controller
// surfaces) pass `appBar`: below `lg` the site header gives way to a compact
// sticky app bar carrying the page's live status. From `lg` up the site's
// standard chrome returns, so the page matches the rest of the website.
// These pages can also pin a `bottomBar` to the viewport bottom; the shell
// aligns it with the content column and keeps the content clear of it.
export function SiteShell({
  subtitle,
  actions,
  readingColumn = false,
  appBar,
  bottomBar,
  bottomBarLgHidden = false,
  contentClassName,
  toaster = false,
  children,
}: {
  subtitle: string
  actions?: ReactNode
  // Cap the content at a reading width inside the shared page column.
  readingColumn?: boolean
  // Content for the phone app bar; pass `true` for the default brand row.
  // Omit it entirely to keep the site header at every viewport.
  appBar?: ReactNode
  // Content for a bar pinned to the viewport bottom (tab bar, submit
  // footer). The shell owns the fixed chrome, centers the content on the
  // same column as the page content, and pads the content bottom so nothing
  // ends up hidden under the bar. Part of the app chrome: only rendered for
  // pages that pass `appBar`.
  bottomBar?: ReactNode
  // Hide the bottom bar from `lg` up (and drop its content clearance
  // there), for bars that belong to the phone chrome only.
  bottomBarLgHidden?: boolean
  contentClassName?: string
  toaster?: boolean
  children: ReactNode
}) {
  const siteHeader = <PublicSiteHeader subtitle={subtitle} actions={actions} />

  // The fixed bottom bar only renders in the app chrome (the `appBar`
  // branch below), so toast clearance keys off both props together.
  const hasBottomBar = Boolean(appBar && bottomBar)
  const toastOffset = hasBottomBar
    ? { bottom: 'var(--site-shell-toast-offset)' }
    : undefined

  return (
    <main
      className={cn(
        'min-h-svh bg-background text-foreground',
        // Bottom clearance for the Toaster while a bar is pinned to the
        // viewport bottom: 5rem clears the taller bar (the ~65px decklist
        // submit footer) with room to spare. Sonner applies `offset` above
        // 600px and `mobileOffset` at or below it — its own breakpoint, not
        // Tailwind's — so both Toaster props read this one variable, and the
        // `lg:` reset here is what returns lg-hidden bars to sonner's stock
        // 24px desktop offset once the bar disappears.
        hasBottomBar &&
          (bottomBarLgHidden
            ? '[--site-shell-toast-offset:5rem] lg:[--site-shell-toast-offset:1.5rem]'
            : '[--site-shell-toast-offset:5rem]'),
      )}
    >
      {appBar ? (
        <>
          <header className="sticky top-0 z-10 border-b border-border bg-background lg:hidden">
            <div className={cn(pageColumnClasses, 'py-3')}>
              {appBar === true ? (
                <div className="flex items-center gap-3">
                  <BrandMark className="size-8" />
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
              pageColumnClasses,
              // Below `lg` the column always ends in pb-24: clearance for the
              // fixed bottom bar when one is pinned there, and the app
              // chrome's resting bottom padding otherwise. From `lg` up the
              // clearance stays only while a bar is still visible.
              bottomBar && !bottomBarLgHidden ? 'pb-24' : 'pb-24 lg:pb-16',
              contentClassName,
            )}
          >
            {children}
          </div>
          {bottomBar ? (
            <div
              className={cn(
                'fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background',
                bottomBarLgHidden && 'lg:hidden',
              )}
            >
              <div className={pageColumnClasses}>{bottomBar}</div>
            </div>
          ) : null}
        </>
      ) : (
        <>
          {siteHeader}
          <section className={cn(pageColumnClasses, 'py-8')}>
            <div
              className={cn(
                readingColumn && readingColumnClasses,
                // A zero-minimum grid track lets wide tables scroll inside
                // their own containers instead of widening the page.
                'grid grid-cols-1 gap-6',
                contentClassName,
              )}
            >
              {children}
            </div>
          </section>
        </>
      )}
      {toaster ? (
        <Toaster
          // Sonner renders the toaster inline (no portal), so it inherits the
          // clearance variable set on <main> above. Object form keeps the
          // other sides on sonner's defaults; pages without a bottom bar get
          // the stock Toaster.
          offset={toastOffset}
          mobileOffset={toastOffset}
        />
      ) : null}
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
