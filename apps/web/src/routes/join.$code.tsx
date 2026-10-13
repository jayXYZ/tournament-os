import { Link, Navigate, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { SearchX } from 'lucide-react'
import { api } from '@paper-pairings/backend/convex/_generated/api'
import { SiteShell } from '@/components/shared/site-shell'
import { LoadingCard } from '@/components/shared/loading-card'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

// The join URL an organizer shares or prints (or a player types from a code
// read aloud). The code is either the event's public code or, for a private
// event, its invite code; the server tells them apart and resolves either to
// the event page. An invite code rides along in the ?invite search param,
// where it opens the private event and is passed on to registration.
export const Route = createFileRoute('/join/$code')({
  component: RouteComponent,
})

function RouteComponent() {
  const { code } = Route.useParams()
  const resolved = useQuery(api.tournaments.invites.resolveJoinCode, { code })

  if (resolved) {
    return (
      <Navigate
        to="/tournaments/$tournamentId"
        params={{ tournamentId: resolved.publicCode }}
        search={{ invite: resolved.inviteCode }}
        replace
      />
    )
  }

  return (
    <SiteShell subtitle="Join a tournament" readingColumn>
      {resolved === undefined ? (
        <LoadingCard title="Opening event" description="Looking up the code." />
      ) : (
        <Empty className="min-h-80">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Code not found</EmptyTitle>
            <EmptyDescription>
              This code is invalid or no longer works. Ask the organizer for a
              current link.
            </EmptyDescription>
          </EmptyHeader>
          <Button asChild type="button" variant="outline">
            <Link to="/">Browse upcoming tournaments</Link>
          </Button>
        </Empty>
      )}
    </SiteShell>
  )
}
