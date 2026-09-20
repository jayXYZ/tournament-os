import { Link, Navigate, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { SearchX } from 'lucide-react'
import { api } from '@paper-pairings/backend/convex/_generated/api'
import { SiteShell } from '@/components/shared/site-shell'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'

// The invite-link landing URL: the one an organizer shares (or a player types
// from a code read aloud). It resolves the code to its event and forwards to
// the event page with the code in the ?invite search param, where it opens a
// private event and rides along on registration.
export const Route = createFileRoute('/join/$inviteCode')({
  component: RouteComponent,
})

function RouteComponent() {
  const { inviteCode } = Route.useParams()
  const resolved = useQuery(api.tournaments.invites.resolveInviteCode, {
    inviteCode,
  })

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
    <SiteShell subtitle="Tournament invite" readingColumn>
      {resolved === undefined ? (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-medium">Opening invite</h2>
            <p className="text-xs/relaxed text-muted-foreground">
              Looking up the event.
            </p>
          </div>
          <TableLoadingSkeleton />
        </section>
      ) : (
        <Empty className="min-h-80">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>Invite not found</EmptyTitle>
            <EmptyDescription>
              This invite link is invalid or has been disabled. Ask the
              organizer for a current link.
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
