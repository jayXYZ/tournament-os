import { createContext, useContext, useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  useMyCurrentMatch,
  useMyDecklist,
  useRoundTimer,
} from '@tournament-os/core'
import {
  ChevronRight,
  ListOrdered,
  Menu,
  ScrollText,
  Swords,
} from 'lucide-react'
import { CurrentMatchCard } from './current-match-card'
import { MoreTab } from './more-tab'
import { PlayerAccessShell, playerShellWidth } from './player-access-shell'
import { StandingsList } from './standings-list'
import { usePlayerTournamentAccess } from './use-player-tournament-access'
import type { ReactNode } from 'react'
import type { RoundTimer } from '@tournament-os/core'
import type { PlayerTournamentEvent } from './use-player-tournament-access'
import { RoundTimerPill } from '@/components/shared/round-timer-indicator'
import { SiteShell, SiteShellBackLink } from '@/components/shared/site-shell'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'
import { useIsDesktop } from '@/hooks/use-desktop'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

type ControllerTab = 'match' | 'standings' | 'more'

export function PlayerController({ publicCode }: { publicCode: string }) {
  const access = usePlayerTournamentAccess(publicCode)

  // publicCode comes synchronously from the route, so the header's
  // event-page link can render from the very first paint instead of popping
  // in once queries resolve. Every state passes it except notFound: there is
  // no event page for a code that resolved to nothing, so the link shows
  // while the outcome is unknown and drops out only once not-found is
  // certain — a pop-out on that error path, never a pop-in on the happy path.
  const eventPageAction = (
    <SiteShellBackLink
      to="/tournaments/$tournamentId"
      params={{ tournamentId: publicCode }}
    >
      Event page
    </SiteShellBackLink>
  )

  if (access.state !== 'ready') {
    return (
      <SiteShell
        width={playerShellWidth}
        subtitle="Player controller"
        actions={access.state === 'notFound' ? undefined : eventPageAction}
        appBar
        toaster
      >
        <PlayerAccessShell
          access={access}
          publicCode={publicCode}
          signIn={{
            title: 'Sign in to play',
            description:
              'Sign in to see your pairings and report match results.',
          }}
          notRegistered={{
            icon: Swords,
            description:
              'Only players with a confirmed registration can use the player controller for this event.',
          }}
        />
      </SiteShell>
    )
  }

  return (
    <ControllerReady
      publicCode={publicCode}
      event={access.event}
      eventPageAction={eventPageAction}
    />
  )
}

// Mounted only in the `ready` access state, so its subscriptions exist only
// while the viewer holds a confirmed registration — the player queries
// reject anything less (the server's requireRegisteredPlayer), and losing
// the registration unmounts this subtree on the same client transition.
function ControllerReady({
  publicCode,
  event,
  eventPageAction,
}: {
  publicCode: string
  event: PlayerTournamentEvent
  eventPageAction: ReactNode
}) {
  const typedTournamentId = event.tournament._id
  const currentMatch = useMyCurrentMatch(typedTournamentId)
  // The page's only getMyDecklist subscription — it feeds both the phone
  // decklist callout and the More tab's DecklistCard (passed down as a prop),
  // and it is skipped entirely while the event does not collect decklists.
  const myDecklist = useMyDecklist(
    event.tournament.decklistRequired ? typedTournamentId : null,
  )
  const [tab, setTab] = useState<ControllerTab>('match')
  // Tabs the player has opened at least once. Below `lg` a panel mounts only
  // after its tab is first visited, so a phone parked on the Match tab holds
  // no live subscriptions for standings or match history it never looks at;
  // once visited, a panel stays mounted (CSS-hidden) so returning to its tab
  // is instant. From `lg` up all three panels are visible at once and count
  // as visited, so they remain mounted if the viewport later shrinks.
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<ControllerTab>>(
    () => new Set(['match']),
  )
  const isDesktop = useIsDesktop()

  useEffect(() => {
    if (!isDesktop) return

    setVisitedTabs((prev) =>
      prev.size === 3
        ? prev
        : new Set<ControllerTab>(['match', 'standings', 'more']),
    )
  }, [isDesktop])

  const selectTab = (next: ControllerTab) => {
    setTab(next)
    setVisitedTabs((prev) => (prev.has(next) ? prev : new Set(prev).add(next)))
  }
  const panelMounted = (panel: ControllerTab) =>
    isDesktop || visitedTabs.has(panel)

  // Rendered twice — in the sticky phone app bar below `lg`, and in the
  // sticky status strip under the desktop heading from `lg` up — so the live
  // round state stays pinned in view at every viewport width. Both copies
  // read the RoundTimerProvider wrapped around the layout below through
  // LiveTimerPill; when the timer is idle and no badge applies this renders
  // nothing at all, which both slots rely on.
  const liveStatus = (
    <>
      <LiveTimerPill />
      {currentMatch ? <HeaderBadge currentMatch={currentMatch} /> : null}
    </>
  )
  const showDecklistCallout =
    myDecklist !== undefined &&
    myDecklist !== null &&
    myDecklist.decklist === null &&
    myDecklist.submissionOpen

  return (
    <RoundTimerProvider timer={event.tournament.roundTimer}>
      <SiteShell
        width={playerShellWidth}
        subtitle="Player controller"
        actions={eventPageAction}
        toaster
        appBar={
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {event.tournament.name}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Player controller
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">{liveStatus}</div>
          </div>
        }
        bottomBarLgHidden
        bottomBar={
          // -mx-4 bleeds the tab buttons across the bar column's px-4 inset
          // on phones, restoring full-width native-tab-bar tap targets; from
          // `sm` up they realign with the content column like the rest of
          // the bar.
          <nav className="-mx-4 grid grid-cols-3 sm:mx-0">
            <TabButton
              icon={Swords}
              label="Match"
              active={tab === 'match'}
              onClick={() => selectTab('match')}
            />
            <TabButton
              icon={ListOrdered}
              label="Standings"
              active={tab === 'standings'}
              onClick={() => selectTab('standings')}
            />
            <TabButton
              icon={Menu}
              label="More"
              active={tab === 'more'}
              onClick={() => selectTab('more')}
            />
          </nav>
        }
      >
        <div className="hidden pt-8 lg:block">
          <WorkspacePageHeader
            eyebrow={event.organizationName ?? 'Player controller'}
            title={event.tournament.name}
          />
        </div>

        {/* Desktop stand-in for the phone app bar: no site chrome is sticky
            at `lg`, so the live round status rides this slim strip, which
            pins to the viewport top while long content (standings) scrolls.
            It must hold nothing but the status pills — the `empty:` variant
            is what collapses the strip (rule and all) whenever the timer is
            idle and there is no badge, the same conditions that blank the app
            bar's status slot on phones. */}
        <div className="sticky top-0 z-10 mt-6 hidden items-center justify-end gap-2 border-b border-border bg-background py-2 lg:flex lg:empty:hidden">
          {liveStatus}
        </div>

        {/* One column of cards behind a tab bar on phones; a two-column grid
            with everything visible at once from `lg` up. Sections render only
            where panelMounted says so — see the visitedTabs comment — while
            the class ternaries keep visited-but-inactive sections CSS-hidden
            below `lg`. The column wrappers use `contents` below `lg` so
            hidden or unmounted sections never leave stray grid rows (and
            gaps) behind. */}
        <div className="grid gap-4 pt-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-6 lg:pt-8">
          <div className="contents lg:grid lg:gap-6">
            {showDecklistCallout ? (
              <DecklistCallout publicCode={publicCode} className="lg:hidden" />
            ) : null}
            {panelMounted('match') ? (
              <section
                aria-label="Current match"
                className={cn(
                  tab === 'match' ? 'grid gap-4' : 'hidden lg:grid',
                  'lg:gap-6',
                )}
              >
                <CurrentMatchCard currentMatch={currentMatch} />
              </section>
            ) : null}
            {panelMounted('more') ? (
              <section
                aria-label="Tournament options"
                className={cn(
                  tab === 'more' ? 'grid gap-4' : 'hidden lg:grid',
                  'lg:gap-6',
                )}
              >
                <MoreTab
                  tournamentId={typedTournamentId}
                  publicCode={publicCode}
                  collectsDecklists={event.tournament.decklistRequired}
                  currentMatch={currentMatch}
                  myDecklist={myDecklist}
                />
              </section>
            ) : null}
          </div>
          <div className="contents lg:block">
            {panelMounted('standings') ? (
              <section
                aria-label="Standings"
                className={cn(
                  tab === 'standings' ? 'grid gap-4' : 'hidden lg:grid',
                )}
              >
                <StandingsList tournamentId={typedTournamentId} />
              </section>
            ) : null}
          </div>
        </div>
      </SiteShell>
    </RoundTimerProvider>
  )
}

// The page's only ticking round-timer state. Keeping the useRoundTimer call
// (and its 500ms setNow interval) inside this provider instead of
// ControllerReady means a tick re-renders just the provider — and, because
// ControllerReady hands it an unchanged `children` element, React bails out
// of the whole layout subtree and re-renders only the LiveTimerPill context
// consumers in the two status slots. F12's one-interval property still holds:
// this is the /play subtree's single useRoundTimer, mounted once around the
// confirmed-entry layout; the earlier states render no status slot and no
// provider, so no timer state ticks there at all.
const RoundTimerContext = createContext<ReturnType<
  typeof useRoundTimer
> | null>(null)

function RoundTimerProvider({
  timer,
  children,
}: {
  timer: RoundTimer | null | undefined
  children: ReactNode
}) {
  const snapshot = useRoundTimer(timer)
  return (
    <RoundTimerContext.Provider value={snapshot}>
      {children}
    </RoundTimerContext.Provider>
  )
}

// Presentational pill fed from RoundTimerContext, one per status slot. Like
// RoundTimerPill it renders nothing while the timer is idle, so the `:empty`
// collapse of the slots keeps working.
function LiveTimerPill() {
  const snapshot = useContext(RoundTimerContext)
  return snapshot ? <RoundTimerPill snapshot={snapshot} /> : null
}

// One-tap path to the decklist page while a required list is still missing
// and submission is open; disappears on its own once the list is in (or the
// window closes), so it never nags mid-event. Phone-only: the desktop grid
// always shows the decklist card with its submit button, so a second prompt
// would be noise.
function DecklistCallout({
  publicCode,
  className,
}: {
  publicCode: string
  className?: string
}) {
  return (
    <Link
      to="/tournaments/$tournamentId/decklist"
      params={{ tournamentId: publicCode }}
      className={cn(
        'flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5 transition-colors hover:bg-primary/10',
        className,
      )}
    >
      <ScrollText className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Submit your decklist</span>
        <span className="block text-xs text-muted-foreground">
          This event requires one before it starts.
        </span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </Link>
  )
}

function HeaderBadge({
  currentMatch,
}: {
  currentMatch: NonNullable<ReturnType<typeof useMyCurrentMatch>>
}) {
  if (currentMatch.myRegistrationStatus === 'dropped') {
    return <Badge variant="destructive">Dropped</Badge>
  }
  if (currentMatch.tournament.lifecycle === 'completed') {
    return <Badge variant="secondary">Completed</Badge>
  }
  if (currentMatch.kind === 'not_started') {
    return <Badge variant="outline">Not started</Badge>
  }
  if (
    currentMatch.kind === 'match' ||
    currentMatch.kind === 'between_rounds' ||
    currentMatch.kind === 'pairings_pending'
  ) {
    return <Badge>Round {currentMatch.round.roundNumber}</Badge>
  }
  return null
}

function TabButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Swords
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-col items-center gap-1 py-2.5 text-xs transition-colors',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <Icon className="size-5" aria-hidden="true" />
      {label}
    </button>
  )
}
