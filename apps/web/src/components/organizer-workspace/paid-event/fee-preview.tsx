import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import {
  MIN_ENTRY_FEE_CENTS,
  validateEntryFeeCents,
} from '@tournament-os/shared/payment-fees'
import { formatCents } from '@/lib/money'

// Live fee preview for a draft price: subscribes only once the draft parses
// to a fee the server would accept. Shared by the entry-fee card and the
// ticket-type dialog so their gating can't drift.
export function useFeePreview(draftCents: number) {
  const previewArgs =
    Number.isInteger(draftCents) &&
    draftCents >= MIN_ENTRY_FEE_CENTS &&
    validateEntryFeeCents(draftCents) === null
      ? { entryFeeCents: draftCents }
      : ('skip' as const)
  return useQuery(api.payments.queries.getFeePreview, previewArgs)
}

// The "finish/connect Stripe" nudge shown while the organization cannot be
// paid out. `chargingPhrase` completes "…before charging ___." — e.g. "an
// entry fee", "a badge fee", "for tickets".
export function StripeOnboardingNotice({
  hasConnection,
  chargingPhrase,
}: {
  hasConnection: boolean
  chargingPhrase: string
}) {
  return (
    <p className="text-sm text-muted-foreground">
      {hasConnection
        ? `Finish the organization’s Stripe onboarding before charging ${chargingPhrase}.`
        : `Connect the organization’s Stripe account before charging ${chargingPhrase}.`}{' '}
      <Link to="/admin/organization" className="underline">
        Manage payments
      </Link>
    </p>
  )
}

// The what-buyers-pay breakdown for a previewed price. `payersLabel`:
// 'Players' | 'Attendees'; `paidOutLabel`: 'entry' | 'badge' | 'ticket'.
export function FeePreviewPanel({
  preview,
  payersLabel,
  paidOutLabel,
}: {
  preview:
    | {
        totalCents: number
        entryFeeCents: number
        platformFeeCents: number
        processingFeeCents: number
      }
    | undefined
  payersLabel: string
  paidOutLabel: string
}) {
  if (!preview) {
    return null
  }
  return (
    <div className="rounded-md border bg-muted/50 px-4 py-3 text-sm">
      <p className="font-medium">
        {payersLabel} pay {formatCents(preview.totalCents)}
      </p>
      <p className="text-muted-foreground">
        {formatCents(preview.entryFeeCents)} {paidOutLabel} (paid out to you) +{' '}
        {formatCents(preview.platformFeeCents)} platform fee +{' '}
        {formatCents(preview.processingFeeCents)} estimated payment processing
      </p>
    </div>
  )
}
