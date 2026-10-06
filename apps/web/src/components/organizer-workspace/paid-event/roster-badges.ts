import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'

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

// Order status → labeled roster badge, shared so both rosters show the same
// friendly labels ("Payment due", never a raw "requires_payment").
export const paymentBadge: Record<
  Doc<'paymentOrders'>['status'],
  { label: string; variant: RosterBadgeVariant }
> = {
  requires_payment: { label: 'Payment due', variant: 'outline' },
  awaiting_payment: { label: 'In checkout', variant: 'outline' },
  paid: { label: 'Paid', variant: 'default' },
  expired: { label: 'Unpaid', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
  canceled: { label: 'Unpaid', variant: 'secondary' },
  refunded: { label: 'Refunded', variant: 'secondary' },
  partially_refunded: { label: 'Entry refunded', variant: 'secondary' },
  disputed: { label: 'Disputed', variant: 'destructive' },
}
