import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { StatusTone } from '@/components/shared/status-dot'
import type { DataTableFilterOption } from '@/components/ui/data-table-toolbar'
import { statusDotToneClassName } from '@/components/shared/status-dot'

type RosterBadgeVariant = 'default' | 'secondary' | 'destructive' | 'outline'

// The entry-status vocabulary both registration tables share (CONTEXT.md
// "Entry Status"), spelled once for every roster-side map and filter.
export type EntryStatus = Doc<'tournamentRegistrations'>['entryStatus']

// Entry-status → badge variant, shared by the tournament and badge rosters
// (the tournament roster layers its participation statuses on top).
export const entryStatusBadgeVariant: Record<EntryStatus, RosterBadgeVariant> =
  {
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
// selects labels; paymentStatusesForLabels below turns the selection back
// into the raw statuses the roster queries filter on.
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

// The Payment chip's selected labels → every order status they cover, the
// shape the roster queries take (listRegistrationPage / searchRegistrations
// `payment`), so the server narrows on raw statuses while the organizer
// picks friendly labels. Undefined when nothing is selected, which the
// queries read as "no payment filter".
export function paymentStatusesForLabels(
  labels: ReadonlyArray<string>,
): Array<Doc<'paymentOrders'>['status']> | undefined {
  if (labels.length === 0) {
    return undefined
  }
  const statuses = (
    Object.keys(paymentStatusPresentation) as Array<
      Doc<'paymentOrders'>['status']
    >
  ).filter((status) => labels.includes(paymentStatusPresentation[status].label))
  return statuses.length > 0 ? statuses : undefined
}
