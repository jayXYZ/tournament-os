import { Link, Navigate, createFileRoute } from '@tanstack/react-router'
import { useJoinCode } from '@paper-pairings/core'
import { SearchX, ShieldAlert } from 'lucide-react'
import { useAppAuth } from '@/lib/use-app-auth'
import { SiteShell } from '@/components/shared/site-shell'
import { LoadingCard } from '@/components/shared/loading-card'
import {
  UNVERIFIED_VIEWER_DESCRIPTION,
  UNVERIFIED_VIEWER_TITLE,
  UnverifiedViewerActions,
} from '@/components/shared/viewer-unverified'
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
// where it opens the private event and is passed on to registration. The
// resolution waits on the viewer auth gate as the native screen does
// (useJoinCode): a private event's own players resolve its public code only
// once Convex has verified them, and a viewer it cannot verify is offered
// the gate's recovery rather than "Code not found".
export const Route = createFileRoute('/join/$code')({
  component: RouteComponent,
})

function RouteComponent() {
  const { code } = Route.useParams()
  const { user, loading } = useAppAuth()
  const resolution = useJoinCode(code, { user, loading })

  if (resolution.state === 'resolved') {
    return (
      <Navigate
        to="/tournaments/$tournamentId"
        params={{ tournamentId: resolution.publicCode }}
        search={{ invite: resolution.inviteCode }}
        replace
      />
    )
  }

  return (
    <SiteShell subtitle="Join a tournament" readingColumn>
      {resolution.state === 'loading' ? (
        <LoadingCard title="Opening event" description="Looking up the code." />
      ) : resolution.state === 'unverified' ? (
        <Empty className="min-h-80">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ShieldAlert aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>{UNVERIFIED_VIEWER_TITLE}</EmptyTitle>
            <EmptyDescription>{UNVERIFIED_VIEWER_DESCRIPTION}</EmptyDescription>
          </EmptyHeader>
          <UnverifiedViewerActions />
        </Empty>
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
