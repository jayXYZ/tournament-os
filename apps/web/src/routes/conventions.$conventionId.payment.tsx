import { Link, createFileRoute } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { SearchX } from 'lucide-react'
import { api } from '@tournament-os/backend/convex/_generated/api'
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

// Stripe Checkout return page for badge purchases. The status dispatch and
// outcome UI live in components/shared/payment-return.tsx; this route
// supplies the convention queries, copy, and links.
export const Route = createFileRoute('/conventions/$conventionId/payment')({
  validateSearch: paymentReturnSearch,
  component: RouteComponent,
})

const copy: PaymentReturnCopy = {
  noOrderDescription:
    'Sign in with the account you paid with, or head back to the convention page to register.',
  paidConfirmedDescription:
    'Payment received and your convention badge is confirmed. See you there.',
  paidUnconfirmedTitle: 'Payment received — badge not confirmed',
  paidUnconfirmedDescription:
    'Your badge could not be confirmed when the payment landed — badges may have sold out, or registration may have closed during checkout — so the payment is being refunded in full automatically.',
  partialRefundTitle: 'Badge cost refunded',
  partialRefundDescription:
    'Your badge cost was refunded; the platform and payment processing fees are not refunded on a repeat cancellation.',
  notCompletedDescription:
    "This checkout didn't finish. You can start again from the convention page.",
}

function RouteComponent() {
  const { conventionId: publicCode } = Route.useParams()

  return (
    <SiteShell
      subtitle="Badge payment"
      toaster
      actions={
        <SiteShellBackLink
          to="/conventions/$conventionId"
          params={{ conventionId: publicCode }}
        >
          Back to convention
        </SiteShellBackLink>
      }
    >
      <PaymentOutcome publicCode={publicCode} />
    </SiteShell>
  )
}

function PaymentOutcome({ publicCode }: { publicCode: string }) {
  const result = useQuery(api.conventions.lifecycle.getPublicConvention, {
    publicCode,
  })
  const backLink = (
    <Link to="/conventions/$conventionId" params={{ conventionId: publicCode }}>
      Back to the convention page
    </Link>
  )

  if (result === undefined) {
    return <PaymentPendingCard title="Loading the convention" />
  }
  if (result === null) {
    return (
      <PaymentOutcomeCard
        icon={<SearchX aria-hidden="true" />}
        title="Convention not found"
        description="This convention does not exist or is not open to the public."
        backLink={backLink}
      />
    )
  }
  return (
    <OrderOutcome conventionId={result.convention._id} backLink={backLink} />
  )
}

function OrderOutcome({
  conventionId,
  backLink,
}: {
  conventionId: Id<'conventions'>
  backLink: ReactNode
}) {
  const order = useQuery(api.payments.queries.getMyBadgeOrder, {
    conventionId,
  })
  const badge = useQuery(api.conventions.registrations.getMyBadge, {
    conventionId,
  })

  return (
    <PaymentReturnOutcome
      order={order}
      entryConfirmed={
        badge === undefined ? undefined : badge?.entryStatus === 'confirmed'
      }
      copy={copy}
      backLink={backLink}
    />
  )
}
