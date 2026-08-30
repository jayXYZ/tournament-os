import { useState } from 'react'
import { mutationErrorMessage } from '@tournament-os/core'
import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from 'convex/react'
import { Building2, CalendarDays, LogIn, Ticket, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@tournament-os/backend/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type {
  Doc,
  Id,
} from '@tournament-os/backend/convex/_generated/dataModel'
import { formatConventionDateRange } from '@/components/conventions/convention-display'
import { DetailLine } from '@/components/shared/detail-line'
import { LoadMoreButton } from '@/components/shared/load-more-button'
import { LoadingCard } from '@/components/shared/loading-card'
import { MarkdownContent } from '@/components/shared/markdown-content'
import { PageNotFound } from '@/components/shared/page-not-found'
import { cancelOutcomeNote } from '@/components/shared/payment-return'
import { SiteShell, SiteShellBackLink } from '@/components/shared/site-shell'
import {
  TournamentLifecycleBadge,
  TournamentTable,
} from '@/components/tournaments'
import { useBusyAction } from '@/hooks/use-busy-action'
import { useAppAuth } from '@/lib/use-app-auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { formatCents } from '@/lib/money'

const EVENTS_PAGE_SIZE = 50

type Convention = Doc<'conventions'>

export function ConventionPublicPage({ publicCode }: { publicCode: string }) {
  return (
    <SiteShell
      subtitle="Convention details"
      toaster
      actions={<SiteShellBackLink to="/">All events</SiteShellBackLink>}
    >
      <ConventionPublicPageContent publicCode={publicCode} />
    </SiteShell>
  )
}

function ConventionPublicPageContent({ publicCode }: { publicCode: string }) {
  const result = useQuery(api.conventions.lifecycle.getPublicConvention, {
    publicCode,
  })

  return result === undefined ? (
    <LoadingCard
      title="Loading convention"
      description="Fetching convention details."
    />
  ) : result === null ? (
    <PageNotFound
      title="Convention not found"
      description="This convention does not exist or is not open to the public."
    />
  ) : (
    <ConventionDetails
      convention={result.convention}
      organizationName={result.organizationName}
      registeredCount={result.registeredCount}
    />
  )
}

function ConventionDetails({
  convention,
  organizationName,
  registeredCount,
}: {
  convention: Convention
  organizationName: string | null
  registeredCount: number
}) {
  const badgesLeft = Math.max(convention.playerCapacity - registeredCount, 0)
  const {
    results: children,
    status: childrenStatus,
    loadMore: loadMoreChildren,
  } = usePaginatedQuery(
    api.conventions.events.listPublicChildEvents,
    { conventionId: convention._id },
    { initialNumItems: EVENTS_PAGE_SIZE },
  )
  const childItems =
    childrenStatus === 'LoadingFirstPage'
      ? undefined
      : children.map((row) => ({
          key: row._id,
          organizationName: row.organizationName,
          registeredCount: row.registeredCount,
          tournament: row,
        }))

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="text-2xl">{convention.name}</CardTitle>
            <TournamentLifecycleBadge lifecycle={convention.lifecycle} />
          </div>
          <CardDescription>
            {convention.isTestEvent
              ? 'Test convention'
              : convention.visibility === 'private'
                ? 'Private convention'
                : 'Convention'}
            {organizationName ? ` hosted by ${organizationName}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <DetailLine
              icon={CalendarDays}
              label="Dates"
              value={formatConventionDateRange(
                convention.startDate,
                convention.endDate,
              )}
            />
            <DetailLine
              icon={Users}
              label="Badges"
              value={`${registeredCount} of ${convention.playerCapacity} registered`}
            />
            {organizationName ? (
              <DetailLine
                icon={Building2}
                label="Organizer"
                value={organizationName}
              />
            ) : null}
            {convention.badgeRequiredForChildEvents ? (
              <DetailLine
                icon={Ticket}
                label="Events"
                value="Convention badge required to register"
              />
            ) : null}
          </div>
          <Separator />
          <BadgePanel convention={convention} badgesLeft={badgesLeft} />
          {convention.detailsMarkdown ? (
            <>
              <Separator />
              <MarkdownContent markdown={convention.detailsMarkdown} />
            </>
          ) : null}
        </CardContent>
      </Card>

      <TournamentTable variant="public" items={childItems} />
      <LoadMoreButton
        status={childrenStatus}
        onLoadMore={() => loadMoreChildren(EVENTS_PAGE_SIZE)}
        label="Load more events"
        loadingLabel="Loading more events…"
      />
    </div>
  )
}

// The badge counterpart of the tournament page's RegistrationPanel, much
// simpler: badges have no approval mode, waitlist, or competitive states.
// The convention sells ticket types (ADR 0004) — the panel lists each pass
// with its price and availability; free passes register directly, paid ones
// go through checkout.
function BadgePanel({
  convention,
  badgesLeft,
}: {
  convention: Convention
  badgesLeft: number
}) {
  const { user, loading, refreshAuth } = useAppAuth()
  const badge = useQuery(
    api.conventions.registrations.getMyBadge,
    user ? { conventionId: convention._id } : 'skip',
  )
  const ticketTypes = useQuery(
    api.conventions.ticketTypes.listPublicTicketTypes,
    {
      conventionId: convention._id,
    },
  )
  const cancelBadge = useMutation(api.conventions.registrations.cancelMyBadge)
  const myOrder = useQuery(
    api.payments.queries.getMyBadgeOrder,
    user ? { conventionId: convention._id } : 'skip',
  )
  const refundFlag = useQuery(
    api.payments.queries.getMyBadgeRefundFlag,
    user ? { conventionId: convention._id } : 'skip',
  )
  const createBadgeCheckout = useAction(
    api.payments.checkout.createBadgeCheckout,
  )
  const { busy, run } = useBusyAction()
  // Checkout leaves the page for Stripe, so its pending flag deliberately
  // stays set through the redirect.
  const [checkoutPending, setCheckoutPending] = useState(false)
  const pending = busy || checkoutPending

  const registrationOpen = convention.lifecycle === 'registration'
  const checkingButton = (
    <Button type="button" variant="outline" disabled className="w-fit">
      <Spinner />
      Checking your registration
    </Button>
  )
  const closedNote = (
    <p className="text-sm text-muted-foreground">
      Badge registration is closed for this convention.
    </p>
  )
  const badgesLeftNote = (
    <p className="text-sm text-muted-foreground">
      {badgesLeft === 1 ? '1 badge left' : `${badgesLeft} badges left`}
    </p>
  )
  const cancelNote = myOrder?.cancelOutcome ? (
    <p className="w-full text-sm text-muted-foreground">
      {cancelOutcomeNote(
        myOrder.cancelOutcome,
        'Cancelling refunds the badge cost only — fees are not refunded on a repeat cancellation.',
      )}
    </p>
  ) : null

  const startCheckout = async (ticketTypeId: Id<'conventionTicketTypes'>) => {
    setCheckoutPending(true)
    try {
      const { url } = await createBadgeCheckout({
        conventionId: convention._id,
        ticketTypeId,
      })
      window.location.assign(url)
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not start checkout.'))
      setCheckoutPending(false)
    }
  }

  const heldTicketName = badge
    ? (ticketTypes?.find((t) => t.ticketTypeId === badge.ticketTypeId)?.name ??
      null)
    : null

  if (loading) {
    return checkingButton
  }

  if (!user) {
    if (!registrationOpen) {
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
        {badgesLeftNote}
      </div>
    )
  }

  if (badge === undefined) {
    return checkingButton
  }

  if (badge?.entryStatus === 'confirmed') {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge>
          {heldTicketName
            ? `You're registered — ${heldTicketName}`
            : "You're registered for the convention"}
        </Badge>
        {registrationOpen ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() =>
                void run(async () => {
                  await cancelBadge({ conventionId: convention._id })
                  toast.success('Your convention registration was cancelled.')
                }, 'Could not cancel your registration.')
              }
            >
              {pending ? <Spinner /> : null}
              Cancel registration
            </Button>
            {cancelNote}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            See you at the convention.
          </p>
        )}
      </div>
    )
  }

  // A pending badge is a paid checkout in flight: payment takes the badge.
  if (badge?.entryStatus === 'pending') {
    const paymentDue =
      myOrder?.status === 'requires_payment' ||
      myOrder?.status === 'awaiting_payment'
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="outline">
          {heldTicketName
            ? `Payment required to finish registering — ${heldTicketName}`
            : 'Payment required to finish registering'}
        </Badge>
        {paymentDue && registrationOpen ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() => void startCheckout(badge.ticketTypeId)}
          >
            {pending ? <Spinner /> : null}
            Complete payment — {formatCents(myOrder.amountBreakdown.totalCents)}
          </Button>
        ) : null}
        {registrationOpen ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              void run(async () => {
                await cancelBadge({ conventionId: convention._id })
                toast.success('Your convention registration was withdrawn.')
              }, 'Could not withdraw your registration.')
            }
          >
            Withdraw
          </Button>
        ) : (
          closedNote
        )}
      </div>
    )
  }

  if (badge?.entryStatus === 'rejected') {
    return (
      <Badge variant="destructive">
        Your convention registration was declined
      </Badge>
    )
  }

  if (!registrationOpen) {
    return closedNote
  }

  if (badgesLeft === 0) {
    return (
      <Button type="button" variant="outline" disabled className="w-fit">
        Convention badges are sold out
      </Button>
    )
  }

  if (ticketTypes === undefined) {
    return checkingButton
  }
  if (ticketTypes.length === 0) {
    return closedNote
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {ticketTypes.map((ticketType) => (
          <TicketTypeRow
            key={ticketType.ticketTypeId}
            convention={convention}
            ticketType={ticketType}
            pending={pending}
            onBuy={() => void startCheckout(ticketType.ticketTypeId)}
          />
        ))}
      </div>
      {badgesLeftNote}
      {refundFlag?.repeatDropFeesKept ? (
        <p className="text-sm text-muted-foreground">
          You previously received a refund for this convention — if you cancel
          again after paying, only the badge cost is refunded.
        </p>
      ) : null}
    </div>
  )
}

type PublicTicketType = FunctionReturnType<
  typeof api.conventions.ticketTypes.listPublicTicketTypes
>[number]

// One purchasable pass: name, dates it admits, price with the fee breakdown
// (the same shared math the checkout snapshots), and its availability.
function TicketTypeRow({
  convention,
  ticketType,
  pending,
  onBuy,
}: {
  convention: Convention
  ticketType: PublicTicketType
  pending: boolean
  onBuy: () => void
}) {
  const registerSelf = useMutation(
    api.conventions.registrations.registerSelfForConvention,
  )
  const { busy, run } = useBusyAction()
  const isPaid = ticketType.priceCents > 0
  const now = Date.now()
  const saleNotStarted =
    ticketType.saleStartDate !== null && now < ticketType.saleStartDate

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{ticketType.name}</span>
          <span className="text-sm text-muted-foreground">
            {isPaid ? formatCents(ticketType.priceCents) : 'Free'}
          </span>
        </div>
        {ticketType.description ? (
          <p className="text-sm text-muted-foreground">
            {ticketType.description}
          </p>
        ) : null}
        {ticketType.admissionStartDate !== null ||
        ticketType.admissionEndDate !== null ? (
          <p className="text-sm text-muted-foreground">
            Admits{' '}
            {formatConventionDateRange(
              // An unset bound is open-ended, matching the server gate: it
              // admits from the convention's start / through its end.
              ticketType.admissionStartDate ?? convention.startDate,
              ticketType.admissionEndDate ?? convention.endDate,
            )}
          </p>
        ) : null}
        {ticketType.totalWithFeesCents !== null ? (
          <p className="text-sm text-muted-foreground">
            {formatCents(ticketType.totalWithFeesCents)} total with fees
          </p>
        ) : null}
      </div>
      {ticketType.soldOut ? (
        <Button type="button" variant="outline" disabled>
          Sold out
        </Button>
      ) : !ticketType.onSale ? (
        <Button type="button" variant="outline" disabled>
          {saleNotStarted ? 'Sale not started' : 'Sale ended'}
        </Button>
      ) : isPaid ? (
        <Button type="button" disabled={pending || busy} onClick={onBuy}>
          {pending ? <Spinner /> : null}
          Get this badge
        </Button>
      ) : (
        <Button
          type="button"
          disabled={pending || busy}
          onClick={() =>
            void run(async () => {
              await registerSelf({
                conventionId: convention._id,
                ticketTypeId: ticketType.ticketTypeId,
              })
              toast.success("You're registered. See you at the convention!")
            }, 'Could not register.')
          }
        >
          {busy ? <Spinner /> : null}
          Register
        </Button>
      )}
    </div>
  )
}
