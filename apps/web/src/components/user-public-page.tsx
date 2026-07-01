import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { ArrowLeft, SearchX } from 'lucide-react'
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

type PublicPlayer = {
  publicCode: number
  name: string | null
  avatarUrl: string | null
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
          <PlayerProfile player={player} />
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

function PlayerProfile({ player }: { player: PublicPlayer }) {
  const displayName = player.name ?? `Player #${player.publicCode}`
  const initial = displayName.trim().charAt(0).toUpperCase() || '?'

  return (
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
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Tournament history and results will appear here.
        </p>
      </CardContent>
    </Card>
  )
}
