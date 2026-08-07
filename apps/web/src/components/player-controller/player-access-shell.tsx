import { Link } from '@tanstack/react-router'
import { LogIn, SearchX, UserRound } from 'lucide-react'
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
    )
  }

  if (access.state === 'signedOut') {
    return (
      <Empty className="mt-4 min-h-80 border bg-card lg:mt-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserRound aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>{signIn.title}</EmptyTitle>
          <EmptyDescription>{signIn.description}</EmptyDescription>
        </EmptyHeader>
        <Button
          type="button"
          onClick={() => void refreshAuth({ ensureSignedIn: true })}
        >
          <LogIn data-icon="inline-start" />
          Sign in
        </Button>
      </Empty>
    )
  }

  const NotRegisteredIcon = notRegistered.icon
  return (
    <Empty className="mt-4 min-h-80 border bg-card lg:mt-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <NotRegisteredIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>You are not registered</EmptyTitle>
        <EmptyDescription>{notRegistered.description}</EmptyDescription>
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
  )
}
