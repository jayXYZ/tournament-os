import { Link } from '@tanstack/react-router'
import { usePaginatedQuery, useQuery } from 'convex/react'
import { EyeOff, SearchX, Settings } from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { api } from '@tournament-os/backend/convex/_generated/api'
import { SiteShell, SiteShellBackLink } from '@/components/shared/site-shell'
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
    <SiteShell
      subtitle="Player profile"
      actions={<SiteShellBackLink to="/">All tournaments</SiteShellBackLink>}
    >
      {player === undefined ? (
        <LoadingCard />
      ) : player === null ? (
        <NotFound />
      ) : (
        <PlayerProfile player={player} publicCode={publicCode} />
      )}
    </SiteShell>
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

  // getPublicPlayerResults tops up hidden rows server-side, so an empty page
  // means the history is exhausted — with one exception: a hidden stretch
  // longer than the server's read budget returns an empty not-done page whose
  // cursor has already advanced past the rows it did read. Continue
  // automatically; no cap is needed because every call makes budget-sized
  // progress through a finite index, so this always terminates.
  //
  // That empty page can land at any depth, not just on the first one, so the
  // loaded count at the moment each page was requested is what identifies it:
  // if the count is unchanged once the request settles, nothing came back.
  // Without this a "Load older tournaments" click would look dead once per
  // budget-sized run of hidden history.
  const requestedAtCount = useRef<number | null>(null)
  const requestMore = useCallback(() => {
    requestedAtCount.current = results.length
    loadMore(HISTORY_PAGE_SIZE)
  }, [loadMore, results.length])

  useEffect(() => {
    if (status !== 'CanLoadMore') {
      return
    }
    // The first page arrives with no request of ours behind it, so an empty
    // one is recognised by the count alone.
    if (results.length === 0 || requestedAtCount.current === results.length) {
      requestMore()
    }
  }, [results.length, status, requestMore])

  // Never render the "Tournament history" heading/grid over zero cards:
  // while anything is still loading (first page, or the rare budget-bounded
  // continuation above) show the skeleton, and only an exhausted cursor may
  // declare the history empty.
  if (results.length === 0) {
    if (status !== 'Exhausted') {
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
            onClick={requestMore}
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
