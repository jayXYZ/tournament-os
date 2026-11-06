import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import {
  deriveRegistrationAction,
  mutationErrorMessage,
  useMyRefundFlag,
  useMyRegistration,
  useViewerAuthGate,
} from '@paper-pairings/core'
import { useAction, useMutation, useQuery } from 'convex/react'
import { Building2, CalendarDays, LogIn, Swords, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@paper-pairings/backend/convex/_generated/api'
import type { BadgeGate } from '@paper-pairings/core'
import type { FunctionReturnType } from 'convex/server'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import { DetailLine } from '@/components/shared/detail-line'
import { LoadingCard } from '@/components/shared/loading-card'
import { MarkdownContent } from '@/components/shared/markdown-content'
import { PageNotFound } from '@/components/shared/page-not-found'
import { SignInToViewEvent } from '@/components/shared/sign-in-to-view'
import { cancelOutcomeNote } from '@/components/shared/payment-return'
import { RoundTimerIndicator } from '@/components/shared/round-timer-indicator'
import { SiteShell, SiteShellBackLink } from '@/components/shared/site-shell'
import {
  TournamentLifecycleBadge,
  formatTournamentDateLong,
} from '@/components/tournaments'
import { useBusyAction } from '@/hooks/use-busy-action'
import { useMyEntryOrder } from '@/hooks/use-my-order'
import { useAppAuth } from '@/lib/use-app-auth'
import {
  UNVERIFIED_VIEWER_DESCRIPTION,
  UnverifiedViewerActions,
} from '@/components/shared/viewer-unverified'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { formatCents } from '@/lib/money'

type Tournament = Doc<'tournaments'>

export function TournamentPublicPage({
  publicCode,
  inviteCode,
}: {
  publicCode: string
  inviteCode?: string
}) {
  return (
    <SiteShell
      subtitle="Tournament details"
      readingColumn
      toaster
      actions={<SiteShellBackLink to="/">All tournaments</SiteShellBackLink>}
    >
      <TournamentPublicPageContent
        publicCode={publicCode}
        inviteCode={inviteCode}
      />
    </SiteShell>
  )
}

// The public event card without the page chrome, so the admin Overview can
// embed the same view as an organizer preview of what players see. The
// optional invite code (from a /join link's ?invite param) opens a private
// event's page and rides along on the register call; it is meaningless on an
// event the viewer can already see, so nothing here branches on it.
// The owning convention's summary shipped alongside the tournament (see
// getPublicTournament): enough for the "part of" link and the badge-gate
// notice without another query. Derived from the server's return type so
// the two can never drift.
type ConventionSummary = NonNullable<
  NonNullable<
    FunctionReturnType<typeof api.tournaments.lifecycle.getPublicTournament>
  >['convention']
>

export function TournamentPublicPageContent({
  publicCode,
  inviteCode,
}: {
  publicCode: string
  inviteCode?: string
}) {
  const event = useQuery(api.tournaments.lifecycle.getPublicTournament, {
    publicCode,
    inviteCode,
  })
  // A private event answers null to a viewer it doesn't admit, and to its
  // own players until Convex has verified them, so a null waits on the auth
  // gate (as the player access ladder does), and a signed-out viewer is
  // offered sign-in rather than told the event doesn't exist. The native
  // app's "Complete payment" hand-off lands here without a session.
  const { user, loading } = useAppAuth()
  const viewer = useViewerAuthGate({ user, loading })

  return event === undefined || (event === null && viewer === 'pending') ? (
    <LoadingCard
      title="Loading tournament"
      description="Fetching event details."
    />
  ) : event === null && viewer === 'signedOut' ? (
    <SignInToViewEvent className="min-h-80 border bg-card" />
  ) : event === null ? (
    <PageNotFound
      title="Tournament not found"
      description="This event does not exist or is not open to the public."
    />
  ) : (
    <TournamentDetails
      tournament={event.tournament}
      organizationName={event.organizationName}
      registeredCount={event.registeredCount}
      convention={event.convention}
      badgeGate={event.badgeGate}
      inviteCode={inviteCode}
    />
  )
}

function TournamentDetails({
  tournament,
  organizationName,
  registeredCount,
  convention,
  badgeGate,
  inviteCode,
}: {
  tournament: Tournament
  organizationName: string | null
  registeredCount: number
  // Null for a standalone event, and for a convention the viewer may not
  // open (getPublicTournament): its name and code must not leak here.
  convention: ConventionSummary | null
  // The server's badge-gate verdict, independent of whether the convention
  // summary is shown. The notice and the registration panel both read it,
  // so they can never disagree: registerSelf and beginEntryCheckout both
  // reject a gated viewer, so the panel must not offer a button that
  // reaches them.
  badgeGate: BadgeGate
  inviteCode?: string
}) {
  const spotsLeft = Math.max(tournament.playerCapacity - registeredCount, 0)

  return (
    <article className="flex flex-col gap-4">
      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {tournament.name}
          </h1>
          <TournamentLifecycleBadge lifecycle={tournament.lifecycle} />
          <RoundTimerIndicator timer={tournament.roundTimer} />
        </div>
        <p className="text-xs/relaxed text-muted-foreground">
          {tournament.isTestEvent
            ? 'Test event'
            : tournament.visibility === 'private'
              ? 'Private event'
              : 'Public event'}
          {organizationName ? ` hosted by ${organizationName}` : ''}
          {convention ? (
            <>
              {' · part of '}
              <Link
                to="/conventions/$conventionId"
                params={{ conventionId: convention.publicCode }}
                className="underline underline-offset-4"
              >
                {convention.name}
              </Link>
            </>
          ) : null}
        </p>
      </header>
      <Separator />
      <div className="grid gap-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <DetailLine
            icon={CalendarDays}
            label="Starts"
            value={formatTournamentDateLong(tournament.startDate)}
          />
          <DetailLine
            icon={Swords}
            label="Format"
            value={tournament.format}
            capitalize
          />
          <DetailLine
            icon={Users}
            label="Players"
            value={`${registeredCount} of ${tournament.playerCapacity} registered`}
          />
          {organizationName ? (
            <DetailLine
              icon={Building2}
              label="Organizer"
              value={organizationName}
            />
          ) : null}
        </div>
        <Separator />
        {badgeGate !== null && tournament.lifecycle === 'registration' ? (
          <p className="rounded-md border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
            {convention === null ? (
              // A parent the viewer may not open: say what stands in the
              // way without naming or linking it.
              badgeGate === 'missing' ? (
                'This event requires a confirmed convention badge.'
              ) : (
                "Your convention badge does not cover this event's date."
              )
            ) : badgeGate === 'missing' ? (
              <>
                This event requires a confirmed {convention.name} badge —{' '}
                <Link
                  to="/conventions/$conventionId"
                  params={{ conventionId: convention.publicCode }}
                  className="underline underline-offset-4"
                >
                  register for the convention
                </Link>{' '}
                first.
              </>
            ) : (
              <>
                Your {convention.name} badge does not cover this event&apos;s
                date —{' '}
                <Link
                  to="/conventions/$conventionId"
                  params={{ conventionId: convention.publicCode }}
                  className="underline underline-offset-4"
                >
                  upgrade your badge
                </Link>{' '}
                first.
              </>
            )}
          </p>
        ) : null}
        <RegistrationPanel
          tournament={tournament}
          spotsLeft={spotsLeft}
          inviteCode={inviteCode}
          badgeCompsThisEvent={convention?.myBadgeCompsThisEvent ?? false}
          badgeGate={badgeGate}
        />
        {tournament.detailsMarkdown ? (
          <>
            <Separator />
            <MarkdownContent markdown={tournament.detailsMarkdown} />
          </>
        ) : null}
      </div>
      <Separator />
      <p className="text-xs text-muted-foreground">
        {tournament.lifecycle === 'in_progress'
          ? 'The event is under way. Pairings and standings are in your player view.'
          : tournament.lifecycle === 'completed'
            ? 'This event has finished. Final standings are in the player view.'
            : tournament.lifecycle === 'cancelled'
              ? 'This event was cancelled.'
              : 'Pairings and standings appear in your player view once the event begins.'}
      </p>
    </article>
  )
}

function RegistrationPanel({
  tournament,
  spotsLeft,
  inviteCode,
  badgeCompsThisEvent,
  badgeGate,
}: {
  tournament: Tournament
  spotsLeft: number
  inviteCode?: string
  // The viewer's convention pass comps this paid event (ADR 0004): the
  // server-computed flag from getPublicTournament, which routes them to free
  // direct registration instead of Checkout.
  badgeCompsThisEvent: boolean
  // Why the badge gate refuses this viewer (see TournamentDetails), or null
  // when it doesn't. The derivation withholds every button that reaches
  // registerSelf or the checkout while it is set; the notice above the panel
  // says what to do about it.
  badgeGate: BadgeGate
}) {
  const { user, loading, refreshAuth } = useAppAuth()
  const viewer = useViewerAuthGate({ user, loading })
  // Held at `undefined` until Convex auth settles (see useMyRegistration), so
  // an already-registered player never sees a flash of the register button.
  // The order and refund flag wait the same way.
  const registration = useMyRegistration(tournament._id)
  const registerSelf = useMutation(api.tournaments.registrations.registerSelf)
  const cancelRegistration = useMutation(
    api.tournaments.registrations.cancelMyRegistration,
  )
  const createEntryCheckout = useAction(
    api.payments.checkout.createEntryCheckout,
  )
  const isPaid = (tournament.entryFeeCents ?? 0) > 0
  const feePreview = useQuery(
    api.payments.queries.getFeePreview,
    isPaid ? { entryFeeCents: tournament.entryFeeCents! } : 'skip',
  )
  const myOrder = useMyEntryOrder(isPaid ? tournament._id : null)
  const refundFlag = useMyRefundFlag(isPaid ? tournament._id : null)
  const { busy, run } = useBusyAction()
  // Checkout leaves the page for Stripe, so its pending flag deliberately
  // stays set through the redirect (useBusyAction's run would clear it).
  const [checkoutPending, setCheckoutPending] = useState(false)
  const pending = busy || checkoutPending

  // The one decision of what to offer, shared with the native join screen
  // (@paper-pairings/core deriveRegistrationAction). This component only
  // renders it.
  const action = deriveRegistrationAction({
    tournament,
    viewer,
    registration,
    order: myOrder,
    refundFlag,
    badgeGate,
    badgeCompsThisEvent,
    spotsLeft,
  })

  const runAction = (work: () => Promise<unknown>, successMessage: string) =>
    run(async () => {
      await work()
      toast.success(successMessage)
    }, 'Something went wrong')

  const closedNote = (
    <p className="text-sm text-muted-foreground">
      Registration is closed for this event.
    </p>
  )
  const badgeGateButton = (reason: Exclude<BadgeGate, null>) => (
    <Button type="button" variant="outline" disabled className="w-fit">
      {reason === 'wrong_day'
        ? 'Your badge does not cover this date'
        : 'Convention badge required'}
    </Button>
  )
  const fullButton = (
    <Button type="button" variant="outline" disabled className="w-fit">
      Tournament is full
    </Button>
  )
  const spotsLeftText =
    spotsLeft === 1 ? '1 spot left' : `${spotsLeft} spots left`
  const spotsLeftNote = (
    <p className="text-sm text-muted-foreground">{spotsLeftText}</p>
  )
  const cancelButton = (label: string, successMessage: string) => (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={() =>
        void runAction(
          () => cancelRegistration({ tournamentId: tournament._id }),
          successMessage,
        )
      }
    >
      {pending ? <Spinner /> : null}
      {label}
    </Button>
  )
  const withdrawButton = cancelButton(
    'Withdraw registration',
    'Your registration has been withdrawn.',
  )

  const startCheckout = async () => {
    setCheckoutPending(true)
    try {
      const outcome = await createEntryCheckout({
        tournamentId: tournament._id,
        inviteCode,
      })
      if (outcome.kind === 'registered') {
        // The organizer had enrolled this player, and the Claim handed them
        // the seat in that very call: nothing to pay, and the panel above
        // re-renders registered from the live registration query.
        toast.success(
          "You're already registered for this event — there's nothing to pay.",
        )
        setCheckoutPending(false)
        return
      }
      window.location.assign(outcome.url)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not start checkout.'))
      setCheckoutPending(false)
    }
  }

  const totalPrice = feePreview ? formatCents(feePreview.totalCents) : null

  switch (action.kind) {
    case 'loading':
      return (
        <Button type="button" variant="outline" disabled className="w-fit">
          <Spinner />
          Checking your registration
        </Button>
      )

    // Clerk has a user Convex could not verify (see ViewerAuthGate). The
    // viewer may well be registered, and only a verified identity can show
    // them that.
    case 'unverified':
      return (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {UNVERIFIED_VIEWER_DESCRIPTION}
          </p>
          <UnverifiedViewerActions />
        </div>
      )

    case 'signIn':
      return (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={() => void refreshAuth({ ensureSignedIn: true })}
          >
            <LogIn data-icon="inline-start" />
            Sign in to register
          </Button>
          {spotsLeftNote}
        </div>
      )

    // A confirmed seat, whatever the player's participation since: a
    // dropped or disqualified player still holds it, and an eliminated one
    // is out of contention but keeps it too.
    case 'registered': {
      const { participation, next } = action
      return (
        <div className="flex flex-wrap items-center gap-3">
          {participation === 'active' ? (
            <Badge>You&apos;re registered</Badge>
          ) : (
            <Badge variant="secondary">
              {participation === 'disqualified'
                ? 'You were disqualified from this event'
                : participation === 'dropped'
                  ? 'You dropped from this event'
                  : "You've been eliminated from this event"}
            </Badge>
          )}
          {next.kind === 'cancel' ? (
            <>
              {cancelButton(
                'Cancel registration',
                'Your registration has been cancelled.',
              )}
              {/* On a paid event, what happens to the player's money when
                  they release the seat (refund issued, or fees kept under
                  the repeat-drop rule). */}
              {next.cancelOutcome ? (
                <p className="w-full text-sm text-muted-foreground">
                  {cancelOutcomeNote(
                    next.cancelOutcome,
                    'Cancelling refunds the entry cost only — fees are not refunded on a repeat drop.',
                  )}
                </p>
              ) : null}
            </>
          ) : next.kind === 'openPlayerView' ? (
            <>
              <Button asChild type="button">
                <Link
                  to="/tournaments/$tournamentId/play"
                  params={{ tournamentId: tournament.publicCode }}
                >
                  <Swords data-icon="inline-start" />
                  Open my player view
                </Link>
              </Button>
              {participation === 'active' ? null : (
                <p className="text-sm text-muted-foreground">
                  You can still follow standings and your match history.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              The event has started, so registration changes are locked.
            </p>
          )}
        </div>
      )
    }

    // A pending entry with a payable order is past review: an approved
    // application awaiting its payment, or the player's own unfinished
    // direct checkout. Payment takes the seat. While something blocks the
    // payment (PaymentBlock), the entry stays withdrawable until
    // registration closes.
    case 'completePayment':
      return (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">
            {action.purpose === 'post_approval'
              ? 'Application approved — payment required'
              : 'Payment required to finish registering'}
          </Badge>
          {action.blocked === null ? (
            <Button
              type="button"
              disabled={pending}
              onClick={() => void startCheckout()}
            >
              {pending ? <Spinner /> : null}
              {totalPrice
                ? `Complete payment — ${totalPrice}`
                : 'Complete payment'}
            </Button>
          ) : action.blocked === 'closed' ? null : action.blocked === 'full' ? (
            fullButton
          ) : (
            badgeGateButton(action.blocked)
          )}
          {action.blocked === 'closed' ? closedNote : withdrawButton}
        </div>
      )

    // An application under organizer review, or a waitlisted entry, holds
    // no seat yet, so the only self-service action is withdrawing it.
    case 'pendingReview':
    case 'waitlisted':
      return (
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">
            {action.kind === 'waitlisted'
              ? "You're on the waitlist"
              : 'Registration pending organizer approval'}
          </Badge>
          {action.canWithdraw ? withdrawButton : closedNote}
        </div>
      )

    // An organizer decision; the way back is organizer approval, never
    // self-service, so no action is offered.
    case 'rejected':
      return <Badge variant="destructive">Your registration was declined</Badge>

    case 'closed':
      return closedNote

    case 'full':
      return fullButton

    // The notice above the panel says what to do, linking the convention
    // page when the viewer may open it.
    case 'badgeBlocked':
      return (
        <div className="flex flex-wrap items-center gap-3">
          {badgeGateButton(action.reason)}
          {spotsLeftNote}
        </div>
      )

    // Paid direct registration goes through Stripe Checkout: the seat is
    // taken by the payment webhook, never by a mutation from this page.
    case 'pay':
      return (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={pending}
            onClick={() => void startCheckout()}
          >
            {pending ? <Spinner /> : null}
            {totalPrice
              ? `Register — ${totalPrice}`
              : 'Register for this event'}
          </Button>
          <p className="text-sm text-muted-foreground">
            {spotsLeftText}
            {feePreview
              ? ` · ${formatCents(feePreview.entryFeeCents)} entry + ${formatCents(
                  feePreview.platformFeeCents + feePreview.processingFeeCents,
                )} fees`
              : null}
          </p>
          {action.repeatDropFeesKept ? (
            <p className="w-full text-sm text-muted-foreground">
              You previously received a refund for this event — if you cancel
              again after paying, only the entry cost is refunded.
            </p>
          ) : null}
        </div>
      )

    // registerSelf takes the seat, or files the application in approval
    // mode; a paid application is asked for payment once approved. A comped
    // viewer registers here too, never through Checkout.
    case 'register':
    case 'requestToRegister': {
      const application = action.kind === 'requestToRegister'
      return (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              void runAction(
                () =>
                  registerSelf({ tournamentId: tournament._id, inviteCode }),
                application
                  ? 'Registration submitted for organizer approval.'
                  : "You're registered. See you at the event!",
              )
            }
          >
            {pending ? <Spinner /> : null}
            {application ? 'Request to register' : 'Register for this event'}
          </Button>
          <p className="text-sm text-muted-foreground">
            {spotsLeftText}
            {action.comped
              ? ' · included with your convention badge'
              : isPaid && feePreview
                ? ` · ${formatCents(feePreview.totalCents)} due after approval`
                : null}
          </p>
          {/* The viewer already holds the pending entry this seats (its
              badge now comps the payment it owed); releasing it is the
              other way out. */}
          {action.kind === 'register' && action.canWithdraw
            ? withdrawButton
            : null}
        </div>
      )
    }

    default:
      throw new Error(
        `Unhandled registration action: ${JSON.stringify(action satisfies never)}`,
      )
  }
}
