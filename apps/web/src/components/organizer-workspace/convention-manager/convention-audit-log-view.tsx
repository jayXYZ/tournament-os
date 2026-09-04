import { usePaginatedQuery } from 'convex/react'
import { ScrollText } from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { LoadMoreButton } from '@/components/shared/load-more-button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { formatCents } from '@/lib/money'

type ConventionAuditRow = FunctionReturnType<
  typeof api.conventions.auditLog.listAuditEvents
>['page'][number]

const PAGE_SIZE = 50

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

// One line per event kind, denormalized names included — the convention log
// has far fewer shapes than the tournament one, so a sentence each reads
// better than a badge taxonomy.
function describeEvent(row: ConventionAuditRow): string {
  const { event } = row
  const player =
    'player' in event ? (event.player.playerName ?? 'Unknown player') : null
  switch (event.type) {
    case 'badge_registered':
      return `${player} registered for the convention`
    case 'badge_cancelled':
      return `${player} cancelled their badge`
    case 'badge_removed':
      return `${player}'s badge was removed`
    case 'tournament_attached':
      return `${event.tournamentName} was attached to the convention`
    case 'tournament_detached':
      return `${event.tournamentName} was detached from the convention`
    case 'convention_published':
      return 'Convention published — badge registration opened'
    case 'convention_completed':
      return 'Convention completed'
    case 'convention_cancelled':
      return 'Convention cancelled'
    case 'payment_completed':
      return `${player} paid ${formatCents(event.totalCents)} for a badge`
    case 'payment_failed':
      return `${player}'s badge payment failed`
    case 'payment_expired':
      return `${player}'s badge checkout expired`
    case 'refund_issued':
      return `${formatCents(event.amountCents)} refunded to ${player}`
    case 'refund_failed':
      return `A ${formatCents(event.amountCents)} refund to ${player} failed`
    case 'payout_sent':
      return `Badge fees paid out: ${formatCents(event.netCents)}`
    case 'payout_failed':
      return 'Badge fee payout failed'
    case 'order_disputed':
      return `${player}'s badge payment was disputed`
    default:
      return (event as { type: string }).type
  }
}

export function ConventionAuditLogView({
  conventionId,
}: {
  conventionId: Id<'conventions'>
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.conventions.auditLog.listAuditEvents,
    { conventionId },
    { initialNumItems: PAGE_SIZE },
  )

  return (
    <section className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>
            Badge registrations, payments, refunds, and lifecycle changes,
            newest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'LoadingFirstPage' ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : results.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ScrollText />
                </EmptyMedia>
                <EmptyTitle>No activity yet</EmptyTitle>
                <EmptyDescription>
                  Actions taken on this convention will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <ul className="divide-y">
                {results.map((row) => (
                  <li
                    key={row._id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 text-sm"
                  >
                    <span>{describeEvent(row)}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.actorName ? `${row.actorName} · ` : ''}
                      {timeFormatter.format(new Date(row._creationTime))}
                    </span>
                  </li>
                ))}
              </ul>
              <LoadMoreButton
                className="mt-4"
                status={status}
                onLoadMore={() => loadMore(PAGE_SIZE)}
                label="Load older entries"
              />
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
