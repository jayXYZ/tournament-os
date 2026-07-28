import { Link } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { ArrowLeft, EyeOff, SearchX, Settings } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { api } from '@tournament-os/backend/convex/_generated/api'
import { PublicSiteHeader } from '@/components/shared/public-site-header'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { UserPublicTournamentCard } from '@/components/user-public-tournament-card'

const HISTORY_PAGE_SIZE = 10

// getPublicPlayerResults filters registrations (test events, unfinished
// tournaments, visibility) AFTER pagination, so a fetched page can come back
// empty without the cursor being exhausted — e.g. a player whose most recent
// entries are all in-progress. Rather than showing a bare heading over zero
// cards, auto-load additional pages while the accumulated result set is still
// empty. Bounded so a player with a long run of non-qualifying registrations
// can't trigger unbounded fetching.
const HISTORY_AUTO_LOAD_LIMIT = 5

type PublicPlayer = {
  publicCode: number
  name: string | null
  avatarUrl: string | null
  isOwner: boolean
  profileHidden: boolean
  historyVisible: boolean
  historyHidden: boolean
}

export function UserPublicPage({ publicCode }: { publicCode: string }) {
  const player = useQuery(api.users.getPublicPlayer, { publicCode })

  return (
    <main className="min-h-svh bg-background text-foreground">
      <PublicSiteHeader
        maxWidth="4xl"
        subtitle="Player profile"
        actions={
          <Button asChild type="button" variant="ghost">
            <Link to="/">
              <ArrowLeft data-icon="inline-start" />
              All tournaments
            </Link>
          </Button>
        }
      />

      <section className="mx-auto grid max-w-4xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
        {player === undefined ? (
          <LoadingCard />
        ) : player === null ? (
          <NotFound />
        ) : (
          <PlayerProfile player={player} publicCode={publicCode} />
        )}
      </section>
    </main>
  )
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Loading profile</CardTitle>
        <CardDescription>Fetching player details.</CardDescription>
      </CardHeader>
      <CardContent>
        <TableLoadingSkeleton />
      </CardContent>
    </Card>
  )
}

function NotFound() {
  return (
    <Empty className="min-h-80 border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>Player not found</EmptyTitle>
        <EmptyDescription>
          This profile does not exist or is not public.
        </EmptyDescription>
      </EmptyHeader>
      <Button asChild type="button" variant="outline">
        <Link to="/">Browse upcoming tournaments</Link>
      </Button>
    </Empty>
  )
}

function PlayerProfile({
  player,
  publicCode,
}: {
  player: PublicPlayer
  publicCode: string
}) {
  const displayName = player.name ?? `Player #${player.publicCode}`
  const initial = displayName.trim().charAt(0).toUpperCase() || '?'

  return (
    <>
      {player.isOwner && player.profileHidden ? (
        <PrivacyBanner message="Your profile is private — only you can see this page." />
      ) : player.isOwner && player.historyHidden ? (
        <PrivacyBanner message="Your tournament history is hidden — only you can see the results below." />
      ) : null}

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            {player.avatarUrl ? (
              <img
                src={player.avatarUrl}
                alt=""
                className="size-14 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground">
                {initial}
              </div>
            )}
            <div>
              <CardTitle className="text-2xl">{displayName}</CardTitle>
              <CardDescription>Player #{player.publicCode}</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {player.historyVisible ? (
        <TournamentHistory publicCode={publicCode} />
      ) : (
        <HistoryPrivate />
      )}
    </>
  )
}

function PrivacyBanner({ message }: { message: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <EyeOff className="size-4 shrink-0" aria-hidden="true" />
          {message}
        </span>
        <Button asChild type="button" variant="outline" size="sm">
          <Link to="/settings">
            <Settings data-icon="inline-start" />
            Privacy settings
          </Link>
        </Button>
      </CardContent>
    </Card>
  )
}

function HistoryPrivate() {
  return (
    <Card>
      <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
        <EyeOff className="size-4 shrink-0" aria-hidden="true" />
        This player&apos;s tournament history is private.
      </CardContent>
    </Card>
  )
}

function TournamentHistory({ publicCode }: { publicCode: string }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.users.getPublicPlayerResults,
    { publicCode },
    { initialNumItems: HISTORY_PAGE_SIZE },
  )

  // Counts automatic loadMore calls so a run of non-qualifying registrations
  // can't auto-fetch forever. Reset whenever the profile changes, since this
  // component instance can be reused across a client-side navigation.
  const autoLoadCountRef = useRef(0)
  useEffect(() => {
    autoLoadCountRef.current = 0
  }, [publicCode])

  const canAutoLoadMore =
    status === 'CanLoadMore' &&
    autoLoadCountRef.current < HISTORY_AUTO_LOAD_LIMIT

  useEffect(() => {
    if (results.length === 0 && canAutoLoadMore) {
      autoLoadCountRef.current += 1
      loadMore(HISTORY_PAGE_SIZE)
    }
  }, [results.length, canAutoLoadMore, loadMore])

  if (status === 'LoadingFirstPage') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tournament history</CardTitle>
          <CardDescription>Fetching past results.</CardDescription>
        </CardHeader>
        <CardContent>
          <TableLoadingSkeleton />
        </CardContent>
      </Card>
    )
  }
  if (results.length === 0 && status === 'Exhausted') {
    return (
      <Empty className="border bg-card">
        <EmptyHeader>
          <EmptyTitle>No completed tournaments yet</EmptyTitle>
          <EmptyDescription>
            Results appear here once a tournament this player entered has
            finished.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  // Nothing qualifying has turned up yet, but the cursor isn't exhausted —
  // either still auto-checking further back, or the auto-load budget ran out
  // and the visitor has to opt in to keep checking. Either way, never render
  // the "Tournament history" heading/grid over zero cards.
  if (results.length === 0) {
    if (status === 'LoadingMore' || canAutoLoadMore) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Tournament history</CardTitle>
            <CardDescription>Checking older tournaments…</CardDescription>
          </CardHeader>
          <CardContent>
            <TableLoadingSkeleton />
          </CardContent>
        </Card>
      )
    }
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tournament history</CardTitle>
          <CardDescription>
            No completed tournaments found yet in this player&apos;s most
            recent entries — there may be more further back.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() => loadMore(HISTORY_PAGE_SIZE)}
          >
            Keep checking for older tournaments
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid gap-4">
      <h2 className="text-lg font-semibold">Tournament history</h2>
      {results.map((result) => (
        <UserPublicTournamentCard
          key={result.tournamentId}
          publicCode={publicCode}
          result={result}
        />
      ))}
      {status !== 'Exhausted' ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={status === 'LoadingMore'}
            onClick={() => loadMore(HISTORY_PAGE_SIZE)}
          >
            {status === 'LoadingMore'
              ? 'Loading older tournaments…'
              : 'Load older tournaments'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
