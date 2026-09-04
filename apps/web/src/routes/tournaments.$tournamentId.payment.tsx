import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { SearchX } from 'lucide-react'
import { api } from '@tournament-os/backend/convex/_generated/api'
import { useMyRegistration } from '@tournament-os/core'
import type { ReactNode } from 'react'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import type { PaymentReturnCopy } from '@/components/shared/payment-return'
import {
  PaymentOutcomeCard,
  PaymentPendingCard,
  PaymentReturnOutcome,
  paymentReturnSearch,
} from '@/components/shared/payment-return'
import { SiteShell, SiteShellBackLink } from '@/components/shared/site-shell'

// Stripe Checkout return page for tournament entry fees. The status dispatch
// and outcome UI live in components/shared/payment-return.tsx; this route
// supplies the tournament queries, copy, and links.
export const Route = createFileRoute('/tournaments/$tournamentId/payment')({
  validateSearch: paymentReturnSearch,
  component: RouteComponent,
})

const copy: PaymentReturnCopy = {
  noOrderDescription:
    'Sign in with the account you paid with, or head back to the event page to register.',
  paidConfirmedDescription:
    'Payment received and your seat is confirmed. See you at the event.',
  paidUnconfirmedTitle: 'Payment received — seat not confirmed',
  paidUnconfirmedDescription:
    'Your seat could not be confirmed when the payment landed — the event may have filled up, closed, or your entry may have changed during checkout — so the payment is being refunded in full automatically.',
  partialRefundTitle: 'Entry cost refunded',
  partialRefundDescription:
    'Your entry cost was refunded; the platform and payment processing fees are not refunded on a repeat drop.',
  notCompletedDescription:
    "This checkout didn't finish. You can start again from the event page.",
}

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
  const backLink = (
    <Link to="/tournaments/$tournamentId" params={{ tournamentId: publicCode }}>
      Back to the event page
    </Link>
  )

  if (event === undefined) {
    return <PaymentPendingCard title="Loading the event" />
  }
  if (event === null) {
    return (
      <PaymentOutcomeCard
        icon={<SearchX aria-hidden="true" />}
        title="Tournament not found"
        description="This event does not exist or is not open to the public."
        backLink={backLink}
      />
    )
  }
  return (
    <OrderOutcome tournamentId={event.tournament._id} backLink={backLink} />
  )
}

function OrderOutcome({
  tournamentId,
  backLink,
}: {
  tournamentId: Id<'tournaments'>
  backLink: ReactNode
}) {
  const order = useQuery(api.payments.queries.getMyEntryOrder, {
    tournamentId,
  })
  const registration = useMyRegistration(tournamentId)

  return (
    <PaymentReturnOutcome
      order={order}
      entryConfirmed={
        registration === undefined
          ? undefined
          : registration?.entryStatus === 'confirmed'
      }
      copy={copy}
      backLink={backLink}
    />
  )
}
