import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'

// Conventions share the tournament lifecycle/visibility vocabulary, so their
// badges come straight from components/tournaments/tournament-display.
export type ConventionLifecycle = Doc<'conventions'>['lifecycle']

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

// A convention spans a date range; collapse same-day ranges to one date.
export function formatConventionDateRange(startDate: number, endDate: number) {
  const start = dayFormatter.format(new Date(startDate))
  const end = dayFormatter.format(new Date(endDate))
  return start === end ? start : `${start} – ${end}`
}
