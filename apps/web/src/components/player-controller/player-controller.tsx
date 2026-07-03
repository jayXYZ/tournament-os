import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMyCurrentMatch } from '@tournament-os/core'
import { useQuery } from 'convex/react'
import {
  ListOrdered,
  LogIn,
  Menu,
  SearchX,
  Swords,
  UserRound,
} from 'lucide-react'
import { api } from '@tournament-os/backend/convex/_generated/api'
import { CurrentMatchCard } from './current-match-card'
import { MoreTab } from './more-tab'
import { StandingsList } from './standings-list'
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
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'


type ControllerTab = 'match' | 'standings' | 'more'

export function PlayerController({ publicCode }: { publicCode: string }) {
  const { user, loading, refreshAuth } = useAppAuth()
  const event = useQuery(api.tournaments.lifecycle.getPublicTournament, {
    publicCode,
  })
  const typedTournamentId = event?.tournament._id ?? null
  // getMyRegistration returns null for signed-in users who never registered,
  // so it gates the player queries (which reject unregistered users).
  const registration = useQuery(
    api.tournaments.registrations.getMyRegistration,
    user && typedTournamentId ? { tournamentId: typedTournamentId } : 'skip',
  )
  const currentMatch = useMyCurrentMatch(
    user && registration && typedTournamentId ? typedTournamentId : null,
  )
  const [tab, setTab] = useState<ControllerTab>('match')

  if (loading || event === undefined) {
    return (
      <ControllerFrame>
        <div className="flex min-h-60 items-center justify-center">
          <Spinner className="size-6" />
        </div>
      </ControllerFrame>
    )
  }

  if (event === null || typedTournamentId === null) {
    return (
      <ControllerFrame>
        <Empty className="min-h-80 border bg-card">
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

  if (!user) {
    return (
      <ControllerFrame>
        <Empty className="min-h-80 border bg-card">
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
      <ControllerFrame>
        <div className="grid gap-3 pt-4">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-24" />
          ))}
        </div>
      </ControllerFrame>
    )
  }

  if (registration === null) {
    return (
      <ControllerFrame>
        <Empty className="min-h-80 border bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Swords aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>You are not registered</EmptyTitle>
            <EmptyDescription>
              Only registered players can use the player controller for this
              event.
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

  return (
    <ControllerFrame
      header={
        currentMatch ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {currentMatch.tournament.name}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Player controller
              </p>
            </div>
            <HeaderBadge currentMatch={currentMatch} />
          </div>
        ) : (
          <Skeleton className="h-9" />
        )
      }
    >
      <div className="pt-4">
        {tab === 'match' ? (
          <CurrentMatchCard currentMatch={currentMatch} />
        ) : null}
        {tab === 'standings' ? (
          <StandingsList tournamentId={typedTournamentId} />
        ) : null}
        {tab === 'more' ? (
          <MoreTab
            tournamentId={typedTournamentId}
            currentMatch={currentMatch}
          />
        ) : null}
      </div>

      <nav className="fixed inset-x-0 bottom-0 border-t border-border bg-background">
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

function ControllerFrame({
  header,
  children,
}: {
  header?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background">
        <div className="mx-auto max-w-md px-4 py-3">
          {header ?? (
            <div className="flex items-center gap-3">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Swords className="size-4" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold">Player controller</p>
            </div>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-md px-4 pb-24">{children}</div>
      <Toaster />
    </main>
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
  if (currentMatch.kind === 'match' || currentMatch.kind === 'between_rounds') {
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
        'flex flex-col items-center gap-1 py-2.5 text-xs',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      <Icon className="size-5" aria-hidden="true" />
      {label}
    </button>
  )
}
