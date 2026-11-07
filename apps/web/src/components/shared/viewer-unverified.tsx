import { useRestartConvexAuth } from '@paper-pairings/core'
import { LogOut, RotateCw, ShieldAlert } from 'lucide-react'
import { useAppAuth } from '@/lib/use-app-auth'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { cn } from '@/lib/utils'

// The viewer auth gate's `unverified` state, worded and actioned once for
// every signed-in surface: Clerk has a user but Convex could not verify them
// (see ViewerAuthGate in @paper-pairings/core). "Try again" restarts the
// Convex handshake; "Sign out" ends the Clerk session, after which the gate
// reads signedOut and the surface's ordinary sign-in offer takes over. Plain
// sign-in is deliberately not offered here: the session is live, so Clerk's
// <SignIn /> bounces a single-session instance straight back without
// touching Convex, and a repeat sign-in cannot change a token the server
// refuses (wrong issuer or audience, mismatched environments, …).
export const UNVERIFIED_VIEWER_TITLE = "We couldn't verify your account"
export const UNVERIFIED_VIEWER_DESCRIPTION =
  "You're signed in, but the server couldn't confirm your session. Try again, or sign out and sign back in."

export function UnverifiedViewerActions({ className }: { className?: string }) {
  const restart = useRestartConvexAuth()
  const { signOut } = useAppAuth()

  return (
    <div className={cn('flex flex-wrap items-center gap-3', className)}>
      <Button type="button" onClick={restart}>
        <RotateCw data-icon="inline-start" />
        Try again
      </Button>
      <Button
        type="button"
        variant="outline"
        // Stay on this page: its signed-out state offers the sign-in that
        // brings the viewer straight back here.
        onClick={() => void signOut({ redirectUrl: window.location.href })}
      >
        <LogOut data-icon="inline-start" />
        Sign out
      </Button>
    </div>
  )
}

// The same state as a whole surface, for a page whose lookup answered null
// to a viewer Convex could not verify: a private event they hold a row in
// resolves only for a verified identity, so the null is not yet known to be
// a bad code (the event page, the /join route; useJoinCode and
// usePlayerTournamentAccess read the gate the same way).
export function UnverifiedViewerEmpty({ className }: { className?: string }) {
  return (
    <Empty className={className}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <ShieldAlert aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{UNVERIFIED_VIEWER_TITLE}</EmptyTitle>
        <EmptyDescription>{UNVERIFIED_VIEWER_DESCRIPTION}</EmptyDescription>
      </EmptyHeader>
      <UnverifiedViewerActions />
    </Empty>
  )
}
