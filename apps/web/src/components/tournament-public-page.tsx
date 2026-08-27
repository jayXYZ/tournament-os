import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { mutationErrorMessage, useMyRegistration } from '@tournament-os/core'
import { useAction, useMutation, useQuery } from 'convex/react'
import { Building2, CalendarDays, LogIn, Swords, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { LoadingCard } from '@/components/shared/loading-card'
import { MarkdownContent } from '@/components/shared/markdown-content'
import { PageNotFound } from '@/components/shared/page-not-found'
import { RoundTimerIndicator } from '@/components/shared/round-timer-indicator'
import { SiteShell, SiteShellBackLink } from '@/components/shared/site-shell'
import {
  TournamentLifecycleBadge,
  formatTournamentDateLong,
} from '@/components/tournaments'
import { useBusyAction } from '@/hooks/use-busy-action'
import { useAppAuth } from '@/lib/use-app-auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

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

  return event === undefined ? (
    <LoadingCard
      title="Loading tournament"
      description="Fetching event details."
    />
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
      inviteCode={inviteCode}
    />
  )
}

function TournamentDetails({
  tournament,
  organizationName,
  registeredCount,
  inviteCode,
}: {
  tournament: Tournament
  organizationName: string | null
  registeredCount: number
  inviteCode?: string
}) {
  const spotsLeft = Math.max(tournament.playerCapacity - registeredCount, 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-2xl">{tournament.name}</CardTitle>
          <TournamentLifecycleBadge lifecycle={tournament.lifecycle} />
          <RoundTimerIndicator timer={tournament.roundTimer} />
        </div>
        <CardDescription>
          {tournament.isTestEvent
            ? 'Test event'
            : tournament.visibility === 'private'
              ? 'Private event'
              : 'Public event'}
          {organizationName ? ` hosted by ${organizationName}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
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
        <RegistrationPanel
          tournament={tournament}
          spotsLeft={spotsLeft}
          inviteCode={inviteCode}
        />
        {tournament.detailsMarkdown ? (
          <>
            <Separator />
            <MarkdownContent markdown={tournament.detailsMarkdown} />
          </>
        ) : null}
      </CardContent>
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          Pairings and standings will be available here once the event begins.
        </p>
      </CardFooter>
    </Card>
  )
}

function DetailLine({
  icon: Icon,
  label,
  value,
  capitalize = false,
}: {
  icon: typeof CalendarDays
  label: string
  value: string
  capitalize?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn('font-medium', capitalize && 'capitalize')}>
        {value}
      </span>
    </div>
  )
}

function RegistrationPanel({
  tournament,
  spotsLeft,
  inviteCode,
}: {
  tournament: Tournament
  spotsLeft: number
  inviteCode?: string
}) {
  const { user, loading, refreshAuth } = useAppAuth()
  // Held at `undefined` until Convex auth settles (see useMyRegistration), so
  // an already-registered player never sees a flash of the register button.
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
  const myOrder = useQuery(
    api.payments.queries.getMyEntryOrder,
    isPaid && user ? { tournamentId: tournament._id } : 'skip',
  )
  const refundFlag = useQuery(
    api.payments.queries.getMyRefundFlag,
    isPaid && user ? { tournamentId: tournament._id } : 'skip',
  )
  const { busy, run } = useBusyAction()
  // Checkout leaves the page for Stripe, so its pending flag deliberately
  // stays set through the redirect (useBusyAction's run would clear it).
  const [checkoutPending, setCheckoutPending] = useState(false)
  const pending = busy || checkoutPending

  const runAction = (action: () => Promise<unknown>, successMessage: string) =>
    run(async () => {
      await action()
      toast.success(successMessage)
    }, 'Something went wrong')

  const checkingButton = (
    <Button type="button" variant="outline" disabled className="w-fit">
      <Spinner />
      Checking your registration
    </Button>
  )
  const closedNote = (
    <p className="text-sm text-muted-foreground">
      Registration is closed for this event.
    </p>
  )
  const lockedNote = (
    <p className="text-sm text-muted-foreground">
      The event has started, so registration changes are locked.
    </p>
  )
  const spotsLeftNote = (
    <p className="text-sm text-muted-foreground">
      {spotsLeft === 1 ? '1 spot left' : `${spotsLeft} spots left`}
    </p>
  )
  const controllerLink = (
    <Button asChild type="button">
      <Link
        to="/tournaments/$tournamentId/play"
        params={{ tournamentId: String(tournament.publicCode) }}
      >
        <Swords data-icon="inline-start" />
        Open player controller
      </Link>
    </Button>
  )
  const controllerLinkWithNote = (
    <>
      {controllerLink}
      <p className="text-sm text-muted-foreground">
        You can still follow standings and your match history.
      </p>
    </>
  )
  // On a paid event, tells the player what happened to their money when they
  // release a seat (refund issued, or fees kept under the repeat-drop rule).
  const cancelNote = myOrder?.cancelOutcome ? (
    <p className="w-full text-sm text-muted-foreground">
      {cancelOutcomeNote(myOrder.cancelOutcome)}
    </p>
  ) : null
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

  const startCheckout = async () => {
    setCheckoutPending(true)
    try {
      const { url } = await createEntryCheckout({
        tournamentId: tournament._id,
      })
      window.location.assign(url)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not start checkout.'))
      setCheckoutPending(false)
    }
  }

  const totalPrice = feePreview ? formatCents(feePreview.totalCents) : null

  // One definition of the cancel-registration controls, shared by the active
  // and dropped/disqualified branches so the two player states cannot drift.
  const cancelControls = (
    <>
      {cancelButton(
        'Cancel registration',
        'Your registration has been cancelled.',
      )}
      {cancelNote}
    </>
  )

  if (loading) {
    return checkingButton
  }

  if (!user) {
    if (tournament.lifecycle !== 'registration') {
      return closedNote
    }
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
  }

  if (registration === undefined) {
    return checkingButton
  }

  if (
    registration?.entryStatus === 'confirmed' &&
    registration.participationStatus === 'active'
  ) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge>You&apos;re registered</Badge>
        {tournament.lifecycle === 'registration'
          ? cancelControls
          : tournament.lifecycle === 'in_progress'
            ? controllerLink
            : lockedNote}
      </div>
    )
  }

  // A dropped player still holds their confirmed seat (a mid-play drop, or
  // one preserved by a round-one rewind back into registration); a
  // disqualified player holds theirs too, so this branch covers both.
  // Before play the only self-service action the server accepts is cancelling
  // to release the seat; rejoining is an organizer-side reinstatement. While
  // the event runs, the player controller still admits every confirmed seat,
  // so keep its entry point available for standings and match history.
  if (
    registration?.entryStatus === 'confirmed' &&
    (registration.participationStatus === 'dropped' ||
      registration.participationStatus === 'disqualified')
  ) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">
          {registration.participationStatus === 'disqualified'
            ? 'You were disqualified from this event'
            : 'You dropped from this event'}
        </Badge>
        {tournament.lifecycle === 'registration'
          ? cancelControls
          : tournament.lifecycle === 'in_progress'
            ? controllerLinkWithNote
            : lockedNote}
      </div>
    )
  }

  // An eliminated player is out of contention but keeps their confirmed seat,
  // and the player controller still admits them, so while the event runs it
  // stays their route to live standings and their match history.
  if (
    registration?.entryStatus === 'confirmed' &&
    registration.participationStatus === 'eliminated'
  ) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">
          You&apos;ve been eliminated from this event
        </Badge>
        {tournament.lifecycle === 'in_progress'
          ? controllerLinkWithNote
          : lockedNote}
      </div>
    )
  }

  // An application under organizer review holds no seat yet, so the only
  // self-service action is withdrawing it. These rows must never fall
  // through to the register button below — a second submission would
  // duplicate the live application (registerSelf refuses it server-side
  // too).
  if (
    registration?.entryStatus === 'pending' ||
    registration?.entryStatus === 'waitlisted'
  ) {
    // On a paid event a "pending" entry with a payable order is past review:
    // it is either an approved application awaiting its payment, or the
    // player's own unfinished direct checkout. Payment takes the seat.
    const paymentDue =
      registration.entryStatus === 'pending' &&
      isPaid &&
      (myOrder?.status === 'requires_payment' ||
        myOrder?.status === 'awaiting_payment')
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline">
          {registration.entryStatus === 'waitlisted'
            ? "You're on the waitlist"
            : paymentDue
              ? myOrder.purpose === 'post_approval'
                ? 'Application approved — payment required'
                : 'Payment required to finish registering'
              : 'Registration pending organizer approval'}
        </Badge>
        {paymentDue && tournament.lifecycle === 'registration' ? (
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
        ) : null}
        {tournament.lifecycle === 'registration'
          ? cancelButton(
              'Withdraw registration',
              'Your registration has been withdrawn.',
            )
          : closedNote}
      </div>
    )
  }

  // A rejection is an organizer decision; the way back is organizer
  // approval, never self-service, so no action is offered.
  if (registration?.entryStatus === 'rejected') {
    return <Badge variant="destructive">Your registration was declined</Badge>
  }

  if (tournament.lifecycle !== 'registration') {
    return closedNote
  }

  if (spotsLeft === 0) {
    return (
      <Button type="button" variant="outline" disabled className="w-fit">
        Tournament is full
      </Button>
    )
  }

  // Paid direct registration goes through Stripe Checkout: the seat is taken
  // by the payment webhook, never by a mutation from this page. Approval-mode
  // paid events still file the free application here — payment is requested
  // when the organizer approves.
  if (isPaid && !tournament.registrationRequiresApproval) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={pending}
          onClick={() => void startCheckout()}
        >
          {pending ? <Spinner /> : null}
          {totalPrice ? `Register — ${totalPrice}` : 'Register for this event'}
        </Button>
        <p className="text-sm text-muted-foreground">
          {spotsLeft === 1 ? '1 spot left' : `${spotsLeft} spots left`}
          {feePreview
            ? ` · ${formatCents(feePreview.entryFeeCents)} entry + ${formatCents(
                feePreview.platformFeeCents + feePreview.processingFeeCents,
              )} fees`
            : null}
        </p>
        {refundFlag?.repeatDropFeesKept ? (
          <p className="w-full text-sm text-muted-foreground">
            You previously received a refund for this event — if you cancel
            again after paying, only the entry cost is refunded.
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          void runAction(
            () => registerSelf({ tournamentId: tournament._id, inviteCode }),
            tournament.registrationRequiresApproval
              ? 'Registration submitted for organizer approval.'
              : "You're registered. See you at the event!",
          )
        }
      >
        {pending ? <Spinner /> : null}
        {tournament.registrationRequiresApproval
          ? 'Request to register'
          : 'Register for this event'}
      </Button>
      <p className="text-sm text-muted-foreground">
        {spotsLeft === 1 ? '1 spot left' : `${spotsLeft} spots left`}
        {isPaid && feePreview
          ? ` · ${formatCents(feePreview.totalCents)} due after approval`
          : null}
      </p>
    </div>
  )
}

function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

// The server-computed consequence of cancelling right now (see
// getMyEntryOrder), so this copy can never promise something the cancel
// mutation won't do.
function cancelOutcomeNote(
  outcome: 'full_refund' | 'entry_only_refund' | 'no_refund',
) {
  switch (outcome) {
    case 'full_refund':
      return 'Cancelling refunds your payment in full.'
    case 'entry_only_refund':
      return 'Cancelling refunds the entry cost only — fees are not refunded on a repeat drop.'
    case 'no_refund':
      return 'The refund deadline has passed, so cancelling will not refund your payment.'
  }
}
