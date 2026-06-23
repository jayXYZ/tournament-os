import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'

import { Badge } from '@/components/ui/badge'

type TournamentStatus = Doc<'tournaments'>['status']
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

const tournamentStatuses: Record<
  TournamentStatus,
  { label: string; variant: BadgeVariant }
> = {
  private: { label: 'Private', variant: 'outline' },
  public: { label: 'Open for registration', variant: 'secondary' },
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

export function TournamentStatusBadge({
  status,
}: {
  status: TournamentStatus
}) {
  const badge = tournamentStatuses[status]
  return <Badge variant={badge.variant}>{badge.label}</Badge>
}
