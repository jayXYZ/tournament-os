import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'

import { Badge } from '@/components/ui/badge'

type TournamentLifecycle = Doc<'tournaments'>['lifecycle']
type TournamentVisibility = Doc<'tournaments'>['visibility']
type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive'

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
  { label: string; variant: BadgeVariant }
> = {
  setup: { label: 'Setup', variant: 'outline' },
  registration: { label: 'Open for registration', variant: 'secondary' },
  in_progress: { label: 'In progress', variant: 'default' },
  completed: { label: 'Completed', variant: 'outline' },
  cancelled: { label: 'Cancelled', variant: 'destructive' },
}

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

export function TournamentLifecycleBadge({
  lifecycle,
}: {
  lifecycle: TournamentLifecycle
}) {
  const badge = tournamentLifecycles[lifecycle]
  return <Badge variant={badge.variant}>{badge.label}</Badge>
}

export const tournamentVisibilities: Record<
  TournamentVisibility,
  { label: string; description: string }
> = {
  public: { label: 'Public', description: 'Shown in public listings' },
  unlisted: { label: 'Unlisted', description: 'Anyone with the link' },
  private: { label: 'Private', description: 'Organizers only' },
}

export function TournamentVisibilityBadge({
  visibility,
}: {
  visibility: TournamentVisibility
}) {
  return (
    <Badge variant="outline">{tournamentVisibilities[visibility].label}</Badge>
  )
}
