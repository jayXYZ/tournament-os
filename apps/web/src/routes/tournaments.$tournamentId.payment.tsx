import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { BadgeCheck, Clock, ReceiptText, SearchX } from 'lucide-react'
import { api } from '@tournament-os/backend/convex/_generated/api'
import { useMyRegistration } from '@tournament-os/core'
import type { ReactNode } from 'react'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { SiteShell, SiteShellBackLink } from '@/components/shared/site-shell'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'

// Stripe Checkout return page. It never fulfills anything — the webhook is
// the sole fulfillment path — it just watches the order reactively, so the
// moment the webhook lands the pending state flips to the outcome, whether
// that took milliseconds or the player wandered back hours later.
export const Route = createFileRoute('/tournaments/$tournamentId/payment')({
  // Lenient by design: a mangled or missing session id degrades to the
  // order-status view rather than an error boundary (the order is looked up
  // by the signed-in player, not by the URL).
  validateSearch: (
    search: Record<string, unknown>,
  ): { session_id?: string } => ({
    session_id:
      typeof search.session_id === 'string' ? search.session_id : undefined,
  }),
  component: RouteComponent,
})

function RouteComponent() {
  const { tournamentId: publicCode } = Route.useParams()

  return (
    <SiteShell
      subtitle="Registration payment"
      toaster
      actions={
        <SiteShellBackLink
          to="/tournaments/$tournamentId"
          params={{ tournamentId: publicCode }}
        >
          Back to event
        </SiteShellBackLink>
      }
    >
      <PaymentOutcome publicCode={publicCode} />
    </SiteShell>
  )
}

function PaymentOutcome({ publicCode }: { publicCode: string }) {
  const event = useQuery(api.tournaments.lifecycle.getPublicTournament, {
    publicCode,
  })

  if (event === undefined) {
    return <PendingCard title="Loading the event" />
  }
  if (event === null) {
    return (
      <OutcomeCard
        icon={<SearchX aria-hidden="true" />}
        title="Tournament not found"
        description="This event does not exist or is not open to the public."
        publicCode={publicCode}
      />
    )
  }
  return (
    <OrderOutcome tournamentId={event.tournament._id} publicCode={publicCode} />
  )
}

function OrderOutcome({
  tournamentId,
  publicCode,
}: {
  tournamentId: Id<'tournaments'>
  publicCode: string
}) {
  const order = useQuery(api.payments.queries.getMyEntryOrder, {
    tournamentId,
  })
  const registration = useMyRegistration(tournamentId)

  if (order === undefined || registration === undefined) {
    return <PendingCard title="Checking your payment" />
  }
  if (order === null) {
    return (
      <OutcomeCard
        icon={<ReceiptText aria-hidden="true" />}
        title="No payment found"
        description="Sign in with the account you paid with, or head back to the event page to register."
        publicCode={publicCode}
      />
    )
  }

  switch (order.status) {
    case 'awaiting_payment':
      return (
        <PendingCard title="Confirming your payment">
          This usually takes a few seconds — the page updates by itself once
          Stripe confirms the payment.
        </PendingCard>
      )
    case 'paid':
      if (registration?.entryStatus === 'confirmed') {
        return (
          <OutcomeCard
            icon={<BadgeCheck aria-hidden="true" />}
            title="You're registered!"
            description="Payment received and your seat is confirmed. See you at the event."
            publicCode={publicCode}
          />
        )
      }
      // Paid but not seated: the seat re-check failed (the event filled or
      // closed during checkout) and the automatic refund is on its way.
      return (
        <OutcomeCard
          icon={<ReceiptText aria-hidden="true" />}
          title="Payment received — but the event filled up"
          description="A seat was no longer available when your payment landed, so it is being refunded in full automatically."
          publicCode={publicCode}
        />
      )
    case 'refunded':
      return (
        <OutcomeCard
          icon={<ReceiptText aria-hidden="true" />}
          title="Payment refunded"
          description="This payment was refunded in full. Refunds typically appear on your statement within a few business days."
          publicCode={publicCode}
        />
      )
    case 'partially_refunded':
      return (
        <OutcomeCard
          icon={<ReceiptText aria-hidden="true" />}
          title="Entry cost refunded"
          description="Your entry cost was refunded; the platform and payment processing fees are not refunded on a repeat drop."
          publicCode={publicCode}
        />
      )
    case 'requires_payment':
    case 'expired':
    case 'failed':
    case 'canceled':
      return (
        <OutcomeCard
          icon={<Clock aria-hidden="true" />}
          title="Payment not completed"
          description="This checkout didn't finish. You can start again from the event page."
          publicCode={publicCode}
        />
      )
    case 'disputed':
      return (
        <OutcomeCard
          icon={<ReceiptText aria-hidden="true" />}
          title="Payment disputed"
          description="This payment is under dispute with your card issuer."
          publicCode={publicCode}
        />
      )
  }
}

function PendingCard({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <Empty className="min-h-80 border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Spinner />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {children ? <EmptyDescription>{children}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  )
}

function OutcomeCard({
  icon,
  title,
  description,
  publicCode,
}: {
  icon: ReactNode
  title: string
  description: string
  publicCode: string
}) {
  return (
    <Empty className="min-h-80 border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <Button asChild type="button" variant="outline">
        <Link
          to="/tournaments/$tournamentId"
          params={{ tournamentId: publicCode }}
        >
          Back to the event page
        </Link>
      </Button>
    </Empty>
  )
}
