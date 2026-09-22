import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'

import type { StatusTone } from '@/components/shared/status-dot'
import type { DataTableFilterOption } from '@/components/ui/data-table-toolbar'
import {
  StatusDot,
  statusDotToneClassName,
} from '@/components/shared/status-dot'

export type TournamentLifecycle = Doc<'tournaments'>['lifecycle']
export type TournamentVisibility = Doc<'tournaments'>['visibility']

const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const longDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const tournamentLifecycles: Record<
  TournamentLifecycle,
  { label: string; tone: StatusTone }
> = {
  setup: { label: 'Setup', tone: 'muted' },
  registration: { label: 'Open for registration', tone: 'accent' },
  in_progress: { label: 'In progress', tone: 'live' },
  completed: { label: 'Completed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'danger' },
}

// One filter chip option per lifecycle, in workflow order, each carrying
// the badge's dot so the popover reads like the Status column.
export const tournamentLifecycleFilterOptions: Array<DataTableFilterOption> = (
  Object.keys(tournamentLifecycles) as Array<TournamentLifecycle>
).map((lifecycle) => ({
  value: lifecycle,
  label: tournamentLifecycles[lifecycle].label,
  dotClassName: statusDotToneClassName[tournamentLifecycles[lifecycle].tone],
}))

// The lifecycles an organizer is still working: what the manage table shows
// until they widen the Status filter to finished events.
export const activeTournamentLifecycles: Array<TournamentLifecycle> = [
  'setup',
  'registration',
  'in_progress',
]

export function formatTournamentDateShort(timestamp: number) {
  return shortDateFormatter.format(new Date(timestamp))
}

export function formatTournamentDateLong(timestamp: number) {
  return longDateFormatter.format(new Date(timestamp))
}

export function toDatetimeLocalValue(timestamp: number) {
  const offsetMs = new Date(timestamp).getTimezoneOffset() * 60_000
  return new Date(timestamp - offsetMs).toISOString().slice(0, 16)
}

// Whether the tournament's lifecycle is over — completed or cancelled.
export function isTournamentEnded(lifecycle: TournamentLifecycle) {
  return lifecycle === 'completed' || lifecycle === 'cancelled'
}

export function TournamentLifecycleBadge({
  lifecycle,
}: {
  lifecycle: TournamentLifecycle
}) {
  const status = tournamentLifecycles[lifecycle]
  return <StatusDot tone={status.tone}>{status.label}</StatusDot>
}

export const tournamentVisibilities: Record<
  TournamentVisibility,
  { label: string; description: string }
> = {
  public: { label: 'Public', description: 'Shown in public listings' },
  unlisted: { label: 'Unlisted', description: 'Anyone with the link' },
  private: {
    label: 'Private',
    description: 'Invite links and organizers only',
  },
}

export function TournamentVisibilityBadge({
  visibility,
}: {
  visibility: TournamentVisibility
}) {
  return (
    <StatusDot tone="muted">
      {tournamentVisibilities[visibility].label}
    </StatusDot>
  )
}
