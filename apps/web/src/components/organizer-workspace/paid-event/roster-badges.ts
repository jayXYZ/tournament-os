import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { StatusTone } from '@/components/shared/status-dot'
import type { DataTableFilterOption } from '@/components/ui/data-table-toolbar'
import { statusDotToneClassName } from '@/components/shared/status-dot'

type RosterBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

// Entry-status → badge variant, shared by the tournament and badge rosters
// (the tournament roster layers its participation statuses on top). Both
// registration tables use the same entry-status vocabulary.
export const entryStatusBadgeVariant: Record<
  Doc<'tournamentRegistrations'>['entryStatus'],
  RosterBadgeVariant
> = {
  confirmed: 'default',
  pending: 'outline',
  waitlisted: 'outline',
  cancelled: 'secondary',
  rejected: 'destructive',
}

// Order status → the StatusDot both rosters draw, shared so they show the
// same friendly labels ("Payment due", never a raw "requires_payment").
// Expired and canceled orders both read "Unpaid": the player never paid,
// and how the order lapsed is a detail for the ledger, not the roster.
export const paymentStatusPresentation: Record<
  Doc<'paymentOrders'>['status'],
  { label: string; tone: StatusTone }
> = {
  requires_payment: { label: 'Payment due', tone: 'warning' },
  awaiting_payment: { label: 'In checkout', tone: 'warning' },
  paid: { label: 'Paid', tone: 'live' },
  expired: { label: 'Unpaid', tone: 'muted' },
  failed: { label: 'Failed', tone: 'danger' },
  canceled: { label: 'Unpaid', tone: 'muted' },
  refunded: { label: 'Refunded', tone: 'muted' },
  partially_refunded: { label: 'Entry refunded', tone: 'muted' },
  disputed: { label: 'Disputed', tone: 'danger' },
}

// The Payment chip's options, one per label the column can show. Statuses
// that share a label ("Unpaid") collapse into one option, so the chip
// filters on the label rather than the raw order status: the Payment
// column's accessor returns `paymentLabel(status)` for exactly this reason.
export const paymentFilterOptions: Array<DataTableFilterOption> = Object.values(
  paymentStatusPresentation,
).reduce<Array<DataTableFilterOption>>((options, { label, tone }) => {
  if (!options.some((option) => option.value === label)) {
    options.push({
      value: label,
      label,
      dotClassName: statusDotToneClassName[tone],
    })
  }
  return options
}, [])

export function paymentLabel(status: Doc<'paymentOrders'>['status']) {
  return paymentStatusPresentation[status].label
}
