import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMyCurrentMatch } from '@tournament-os/core'
import { useQuery } from 'convex/react'
import {
  ArrowLeft,
  ChevronRight,
  ListOrdered,
  LogIn,
  Menu,
  ScrollText,
  SearchX,
  Swords,
  UserRound,
} from 'lucide-react'
import { api } from '@tournament-os/backend/convex/_generated/api'
import { ControllerFrame } from './controller-frame'
import { CurrentMatchCard } from './current-match-card'
import { MoreTab } from './more-tab'
import { StandingsList } from './standings-list'
import { RoundTimerIndicator } from '@/components/shared/round-timer-indicator'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'
import { useAppAuth } from '@/lib/use-app-auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

type ControllerTab = 'match' | 'standings' | 'more'

export function PlayerController({ publicCode }: { publicCode: string }) {
  const { user, loading, refreshAuth } = useAppAuth()
  const event = useQuery(api.tournaments.lifecycle.getPublicTournament, {
    publicCode,
  })
  const typedTournamentId = event?.tournament._id ?? null
  // getMyRegistration returns any registration row — including cancelled
  // ones — while the player queries reject entries that are not confirmed,
  // so gate them on entryStatus to match the server's requireRegisteredPlayer.
  const registration = useQuery(
    api.tournaments.registrations.getMyRegistration,
    user && typedTournamentId ? { tournamentId: typedTournamentId } : 'skip',
  )
  const hasConfirmedEntry = registration?.entryStatus === 'confirmed'
  const currentMatch = useMyCurrentMatch(
    user && hasConfirmedEntry && typedTournamentId ? typedTournamentId : null,
  )
  const myDecklist = useQuery(
    api.tournaments.decklists.getMyDecklist,
    user &&
      hasConfirmedEntry &&
      event?.tournament.decklistRequired &&
      typedTournamentId
      ? { tournamentId: typedTournamentId }
      : 'skip',
  )
  const [tab, setTab] = useState<ControllerTab>('match')

  if (loading || event === undefined) {
    return (
      <ControllerFrame subtitle="Player controller">
        <div className="flex min-h-60 items-center justify-center lg:min-h-80">
          <Spinner className="size-6" />
        </div>
      </ControllerFrame>
    )
  }

  if (event === null || typedTournamentId === null) {
    return (
      <ControllerFrame subtitle="Player controller">
        <Empty className="mt-4 min-h-80 border bg-card lg:mt-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Tournament not found</EmptyTitle>
            <EmptyDescription>
              This event does not exist or is not open to the public.
            </EmptyDescription>
          </EmptyHeader>
          <Button asChild type="button" variant="outline">
            <Link to="/">Browse upcoming tournaments</Link>
          </Button>
        </Empty>
      </ControllerFrame>
    )
  }

  const eventPageAction = (
    <Button asChild type="button" variant="ghost">
      <Link
        to="/tournaments/$tournamentId"
        params={{ tournamentId: publicCode }}
      >
        <ArrowLeft data-icon="inline-start" />
        Event page
      </Link>
    </Button>
  )

  if (!user) {
    return (
      <ControllerFrame subtitle="Player controller" actions={eventPageAction}>
        <Empty className="mt-4 min-h-80 border bg-card lg:mt-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UserRound aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Sign in to play</EmptyTitle>
            <EmptyDescription>
              Sign in to see your pairings and report match results.
            </EmptyDescription>
          </EmptyHeader>
          <Button
            type="button"
            onClick={() => void refreshAuth({ ensureSignedIn: true })}
          >
            <LogIn data-icon="inline-start" />
            Sign in
          </Button>
        </Empty>
      </ControllerFrame>
    )
  }

  if (registration === undefined) {
    return (
      <ControllerFrame subtitle="Player controller" actions={eventPageAction}>
        <div className="grid gap-3 pt-4 lg:pt-10">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-24" />
          ))}
        </div>
      </ControllerFrame>
    )
  }

  if (!hasConfirmedEntry) {
    return (
      <ControllerFrame subtitle="Player controller" actions={eventPageAction}>
        <Empty className="mt-4 min-h-80 border bg-card lg:mt-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Swords aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>You are not registered</EmptyTitle>
            <EmptyDescription>
              Only players with a confirmed registration can use the player
              controller for this event.
            </EmptyDescription>
          </EmptyHeader>
          <Button asChild type="button" variant="outline">
            <Link
              to="/tournaments/$tournamentId"
              params={{ tournamentId: publicCode }}
            >
              View event page
            </Link>
          </Button>
        </Empty>
      </ControllerFrame>
    )
  }

  // Rendered twice — sticky app bar on phones, page heading on desktop — so
  // the live round state stays visible in whichever chrome is active.
  const liveStatus = (
    <>
      <RoundTimerIndicator timer={event.tournament.roundTimer} />
      {currentMatch ? <HeaderBadge currentMatch={currentMatch} /> : null}
    </>
  )
  const showDecklistCallout =
    myDecklist !== undefined &&
    myDecklist !== null &&
    myDecklist.decklist === null &&
    myDecklist.submissionOpen

  return (
    <ControllerFrame
      width="6xl"
      subtitle="Player controller"
      actions={eventPageAction}
      mobileHeader={
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
    >
      <div className="hidden pt-8 lg:block">
        <WorkspacePageHeader
          eyebrow={event.organizationName ?? 'Player controller'}
          title={event.tournament.name}
          actions={
            <div className="flex shrink-0 items-center gap-2">{liveStatus}</div>
          }
        />
      </div>

      {/* One column of cards behind a tab bar on phones; a two-column grid
          with everything visible at once from `lg` up. The column wrappers
          use `contents` below `lg` so sections hidden with the tab bar never
          leave stray grid rows (and gaps) behind. */}
      <div className="grid gap-4 pt-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-6 lg:pt-8">
        <div className="contents lg:grid lg:gap-6">
          {showDecklistCallout ? (
            <DecklistCallout publicCode={publicCode} className="lg:hidden" />
          ) : null}
          <section
            aria-label="Current match"
            className={cn(
              tab === 'match' ? 'grid gap-4' : 'hidden lg:grid',
              'lg:gap-6',
            )}
          >
            <CurrentMatchCard currentMatch={currentMatch} />
          </section>
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
            />
          </section>
        </div>
        <div className="contents lg:block">
          <section
            aria-label="Standings"
            className={cn(
              tab === 'standings' ? 'grid gap-4' : 'hidden lg:grid',
            )}
          >
            <StandingsList tournamentId={typedTournamentId} />
          </section>
        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-3">
          <TabButton
            icon={Swords}
            label="Match"
            active={tab === 'match'}
            onClick={() => setTab('match')}
          />
          <TabButton
            icon={ListOrdered}
            label="Standings"
            active={tab === 'standings'}
            onClick={() => setTab('standings')}
          />
          <TabButton
            icon={Menu}
            label="More"
            active={tab === 'more'}
            onClick={() => setTab('more')}
          />
        </div>
      </nav>
    </ControllerFrame>
  )
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
