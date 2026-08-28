import { Link } from '@tanstack/react-router'
import { LogIn, SearchX, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Swords } from 'lucide-react'
import type { PlayerTournamentAccess } from './use-player-tournament-access'
import { useAppAuth } from '@/lib/use-app-auth'

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

// One shell width for the whole player surface. The /play page's SiteShell
// and the /decklist page's DecklistFrame both pass this token, so the desktop
// header rail and content column never resize while queries resolve or when
// navigating between the two pages.
export const playerShellWidth = '6xl'

// Content-row skeletons for waits that happen after the event is known —
// PlayerAccessShell uses it while the registration answer is pending, and the
// decklist page reuses it while the decklist itself loads.
export function PlayerPageSkeleton() {
  return (
    <div className="grid gap-3 pt-4 lg:pt-10">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-24" />
      ))}
    </div>
  )
}

// The standard full-page empty state for player pages: PlayerAccessShell's
// non-ready states, the decklist page's no-decklist-needed state, and the
// editor's submission-closed state all share this one frame.
export function PlayerPageEmpty({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Swords
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <Empty className="mt-4 min-h-80 border bg-card lg:mt-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {children}
    </Empty>
  )
}

// The four non-ready access states, rendered once for every player page.
// Each page wraps this in its own chrome (SiteShell / DecklistFrame) and
// supplies only the copy that differs: the sign-in pitch and the
// not-registered consequence.
export function PlayerAccessShell({
  access,
  publicCode,
  signIn,
  notRegistered,
}: {
  access: Exclude<PlayerTournamentAccess, { state: 'ready' }>
  publicCode: string
  signIn: { title: string; description: string }
  notRegistered: { icon: typeof Swords; description: string }
}) {
  const { refreshAuth } = useAppAuth()

  if (access.state === 'loading') {
    return access.event === null ? (
      <div className="flex min-h-60 items-center justify-center lg:min-h-80">
        <Spinner className="size-6" />
      </div>
    ) : (
      <PlayerPageSkeleton />
    )
  }

  if (access.state === 'notFound') {
    return (
      <PlayerPageEmpty
        icon={SearchX}
        title="Tournament not found"
        description="This event does not exist or is not open to the public."
      >
        <Button asChild type="button" variant="outline">
          <Link to="/">Browse upcoming tournaments</Link>
        </Button>
      </PlayerPageEmpty>
    )
  }

  if (access.state === 'signedOut') {
    return (
      <PlayerPageEmpty
        icon={UserRound}
        title={signIn.title}
        description={signIn.description}
      >
        <Button
          type="button"
          onClick={() => void refreshAuth({ ensureSignedIn: true })}
        >
          <LogIn data-icon="inline-start" />
          Sign in
        </Button>
      </PlayerPageEmpty>
    )
  }

  return (
    <PlayerPageEmpty
      icon={notRegistered.icon}
      title="You are not registered"
      description={notRegistered.description}
    >
      <Button asChild type="button" variant="outline">
        <Link
          to="/tournaments/$tournamentId"
          params={{ tournamentId: publicCode }}
        >
          View event page
        </Link>
      </Button>
    </PlayerPageEmpty>
  )
}
