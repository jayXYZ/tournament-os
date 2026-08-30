import { BadgeCheck, Clock, ReceiptText } from 'lucide-react'
import type { ReactNode } from 'react'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'

// The Stripe Checkout return page shared by tournament entry fees and
// convention badge fees. Both routes render the same order-status dispatch
// and outcome cards; only the entity copy, the queries, and the back link
// differ, so those stay in the routes. The page never fulfills anything —
// the webhook is the sole fulfillment path — it just watches the order
// reactively, so the moment the webhook lands the pending state flips to
// the outcome, whether that took milliseconds or the player wandered back
// hours later.

// Lenient by design: a mangled or missing session id degrades to the
// order-status view rather than an error boundary (the order is looked up
// by the signed-in player, not by the URL).
export function paymentReturnSearch(search: Record<string, unknown>): {
  session_id?: string
} {
  return {
    session_id:
      typeof search.session_id === 'string' ? search.session_id : undefined,
  }
}

// The strings that differ between the two paid-entry kinds.
export type PaymentReturnCopy = {
  noOrderDescription: string
  paidConfirmedDescription: string
  paidUnconfirmedTitle: string
  paidUnconfirmedDescription: string
  partialRefundTitle: string
  partialRefundDescription: string
  notCompletedDescription: string
}

// The server-computed consequence of cancelling right now (see
// getMyEntryOrder), so page copy can never promise something the cancel
// mutation won't do. Only the partial-refund line differs per entry kind
// (repeat drop vs repeat cancellation), so callers supply it.
export function cancelOutcomeNote(
  outcome: 'full_refund' | 'entry_only_refund' | 'no_refund',
  entryOnlyNote: string,
) {
  switch (outcome) {
    case 'full_refund':
      return 'Cancelling refunds your payment in full.'
    case 'entry_only_refund':
      return entryOnlyNote
    case 'no_refund':
      return 'The refund deadline has passed, so cancelling will not refund your payment.'
  }
}

export function PaymentPendingCard({
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

export function PaymentOutcomeCard({
  icon,
  title,
  description,
  backLink,
}: {
  icon: ReactNode
  title: string
  description: string
  // The route's typed <Link> back to the event or convention page.
  backLink: ReactNode
}) {
  return (
    <Empty className="min-h-80 border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <Button asChild type="button" variant="outline">
        {backLink}
      </Button>
    </Empty>
  )
}

export function PaymentReturnOutcome({
  order,
  entryConfirmed,
  copy,
  backLink,
}: {
  order: { status: Doc<'paymentOrders'>['status'] } | null | undefined
  // Whether the entry (registration or badge) is confirmed; undefined while
  // its query is still loading.
  entryConfirmed: boolean | undefined
  copy: PaymentReturnCopy
  backLink: ReactNode
}) {
  if (order === undefined || entryConfirmed === undefined) {
    return <PaymentPendingCard title="Checking your payment" />
  }
  if (order === null) {
    return (
      <PaymentOutcomeCard
        icon={<ReceiptText aria-hidden="true" />}
        title="No payment found"
        description={copy.noOrderDescription}
        backLink={backLink}
      />
    )
  }

  switch (order.status) {
    case 'awaiting_payment':
      return (
        <PaymentPendingCard title="Confirming your payment">
          This usually takes a few seconds — the page updates by itself once
          Stripe confirms the payment.
        </PaymentPendingCard>
      )
    case 'paid':
      if (entryConfirmed) {
        return (
          <PaymentOutcomeCard
            icon={<BadgeCheck aria-hidden="true" />}
            title="You're registered!"
            description={copy.paidConfirmedDescription}
            backLink={backLink}
          />
        )
      }
      // Paid but not seated: the seat re-check refused the payment and the
      // automatic refund is on its way. The page can't tell the exact cause
      // from the order alone, so the copy names the refund, not a cause.
      return (
        <PaymentOutcomeCard
          icon={<ReceiptText aria-hidden="true" />}
          title={copy.paidUnconfirmedTitle}
          description={copy.paidUnconfirmedDescription}
          backLink={backLink}
        />
      )
    case 'refunded':
      return (
        <PaymentOutcomeCard
          icon={<ReceiptText aria-hidden="true" />}
          title="Payment refunded"
          description="This payment was refunded in full. Refunds typically appear on your statement within a few business days."
          backLink={backLink}
        />
      )
    case 'partially_refunded':
      return (
        <PaymentOutcomeCard
          icon={<ReceiptText aria-hidden="true" />}
          title={copy.partialRefundTitle}
          description={copy.partialRefundDescription}
          backLink={backLink}
        />
      )
    case 'requires_payment':
    case 'expired':
    case 'failed':
    case 'canceled':
      return (
        <PaymentOutcomeCard
          icon={<Clock aria-hidden="true" />}
          title="Payment not completed"
          description={copy.notCompletedDescription}
          backLink={backLink}
        />
      )
    case 'disputed':
      return (
        <PaymentOutcomeCard
          icon={<ReceiptText aria-hidden="true" />}
          title="Payment disputed"
          description="This payment is under dispute with your card issuer."
          backLink={backLink}
        />
      )
  }
}
