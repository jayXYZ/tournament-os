import { usePaginatedQuery } from 'convex/react'
import { ScrollText } from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { displayPlayerName, formatGameScoreline } from '@tournament-os/core'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { LoadMoreButton } from '@/components/shared/load-more-button'
import { Badge } from '@/components/ui/badge'
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

type AuditEventRow = FunctionReturnType<
  typeof api.tournaments.auditLog.listAuditEvents
>['page'][number]

type ResultLine = Extract<
  AuditEventRow['event'],
  { type: 'match_result_reported' }
>['result'][number]

const PAGE_SIZE = 50

export function AuditLogView({
  tournamentId,
}: {
  tournamentId: Id<'tournaments'>
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.tournaments.auditLog.listAuditEvents,
    { tournamentId },
    { initialNumItems: PAGE_SIZE },
  )

  return (
    <section className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>
            Every result entry, edit, drop, and lifecycle change, newest first —
            for resolving disputes after the fact.
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
                  Actions taken on this tournament will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <ul className="divide-y">
                {results.map((row) => (
                  <AuditEventItem key={row._id} row={row} />
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

function AuditEventItem({ row }: { row: AuditEventRow }) {
  // Any result-changing event that replaced an existing result is an edit
  // and shows what it replaced, whichever event type carried it.
  const previousResult =
    'previousResult' in row.event ? row.event.previousResult : null

  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={
            row.actorRole === 'organizer'
              ? 'default'
              : row.actorRole === 'system'
                ? 'outline'
                : 'secondary'
          }
        >
          {row.actorRole === 'organizer'
            ? 'Organizer'
            : row.actorRole === 'system'
              ? 'System'
              : 'Player'}
        </Badge>
        {previousResult !== null && (
          <Badge variant="destructive">Result edit</Badge>
        )}
        <span className="text-sm font-medium">
          {row.actorName ??
            (row.actorRole === 'system' ? 'Automatic' : 'Unknown user')}
        </span>
        <span
          className="ml-auto text-xs text-muted-foreground"
          title={new Date(row._creationTime).toISOString()}
        >
          {formatTimestamp(row._creationTime)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{describeEvent(row)}</p>
      {previousResult !== null && (
        <p className="text-sm text-muted-foreground">
          Previous result: {formatScoreline(previousResult)}
        </p>
      )}
    </li>
  )
}

function describeEvent(row: AuditEventRow): string {
  const { event } = row
  switch (event.type) {
    case 'match_result_recorded':
      return `Recorded ${formatScoreline(event.result)} ${matchLocation(event)}`
    case 'match_result_reported':
      return `Reported ${formatScoreline(event.result)} ${matchLocation(event)}`
    case 'match_conceded':
      return `${displayPlayerName(event.player.playerName)} conceded by dropping: ${formatScoreline(event.result)} ${matchLocation(event)}`
    case 'player_registered':
      return `${displayPlayerName(event.player.playerName)} registered for the event`
    case 'registration_requested':
      return `${displayPlayerName(event.player.playerName)} requested to register for the event`
    case 'decklist_submitted':
      return `${displayPlayerName(event.player.playerName)} ${event.isUpdate ? 'updated' : 'submitted'} their decklist (${event.maindeckCardCount} main / ${event.sideboardCardCount} sideboard)`
    case 'registration_cancelled':
      return row.actorRole === 'organizer'
        ? `Cancelled ${displayPlayerName(event.player.playerName)}'s registration`
        : `${displayPlayerName(event.player.playerName)} cancelled their registration`
    case 'registration_approved':
      // previousEntryStatus says which decision the approval was — see the
      // audit event validator.
      return event.previousEntryStatus === 'waitlisted'
        ? `Promoted ${displayPlayerName(event.player.playerName)} from the waitlist`
        : event.previousEntryStatus === 'rejected'
          ? `Reversed ${displayPlayerName(event.player.playerName)}'s rejection and confirmed their registration`
          : `Approved ${displayPlayerName(event.player.playerName)}'s registration`
    case 'registration_rejected':
      return event.previousEntryStatus === 'confirmed'
        ? `Removed ${displayPlayerName(event.player.playerName)} from the event and barred re-entry`
        : event.previousEntryStatus === 'cancelled'
          ? `Barred ${displayPlayerName(event.player.playerName)} from re-entering the event`
          : `Declined ${displayPlayerName(event.player.playerName)}'s registration`
    case 'registration_waitlisted':
      return `Moved ${displayPlayerName(event.player.playerName)}'s registration to the waitlist`
    case 'player_dropped':
      return row.actorRole === 'organizer'
        ? `Dropped ${displayPlayerName(event.player.playerName)} from the event`
        : `${displayPlayerName(event.player.playerName)} dropped from the event`
    case 'player_reinstated':
      return `Reinstated ${displayPlayerName(event.player.playerName)}`
    case 'tournament_published':
      return 'Published the tournament and opened registration'
    case 'player_meeting_started':
      return `Started the phase ${event.phaseOrder} player meeting with ${event.playerCount} players seated`
    case 'tournament_started':
      return `Started the tournament with ${event.playerCount} players and paired round 1`
    case 'round_started':
      return `Paired round ${event.roundNumber} with ${event.playerCount} players`
    case 'round_completed':
      return `Completed round ${event.roundNumber} and posted standings`
    case 'round_rewound':
      return event.reopenedRoundNumber === null
        ? `Unpublished round ${event.removedRoundNumber} pairings and reopened registration`
        : `Unpublished round ${event.removedRoundNumber} pairings and reopened round ${event.reopenedRoundNumber}`
    case 'tournament_completed':
      return 'Completed the tournament'
    case 'tournament_cancelled':
      return 'Cancelled the tournament'
    case 'payment_completed':
      return `${displayPlayerName(event.player.playerName)}'s entry payment of ${formatAuditCents(event.totalCents)} completed`
    case 'payment_failed':
      return `${displayPlayerName(event.player.playerName)}'s entry payment failed`
    case 'payment_expired':
      return `${displayPlayerName(event.player.playerName)}'s checkout expired unpaid`
    case 'payment_requested':
      return `Approved ${displayPlayerName(event.player.playerName)}'s application and requested the ${formatAuditCents(event.totalCents)} entry payment`
    case 'refund_issued':
      return `Refunded ${formatAuditCents(event.amountCents)} to ${displayPlayerName(event.player.playerName)} (${describeRefundReason(event.reason)}${event.kind === 'entry_only' ? ', entry cost only' : ''})`
    case 'refund_failed':
      return `Refund of ${formatAuditCents(event.amountCents)} to ${displayPlayerName(event.player.playerName)} failed — needs attention`
    case 'payout_sent':
      return `Paid out ${formatAuditCents(event.netCents)} in entry fees to the organization`
    case 'payout_failed':
      return 'The entry-fee payout failed — needs attention'
    case 'order_disputed':
      return `${displayPlayerName(event.player.playerName)}'s entry payment was disputed — excluded from the payout`
  }
}

function describeRefundReason(
  reason:
    | 'player_cancel'
    | 'organizer_remove'
    | 'tournament_cancelled'
    | 'seat_unavailable',
) {
  switch (reason) {
    case 'player_cancel':
      return 'player unregistered'
    case 'organizer_remove':
      return 'removed by organizer'
    case 'tournament_cancelled':
      return 'tournament cancelled'
    case 'seat_unavailable':
      return 'no seat available'
  }
}

function formatAuditCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

function matchLocation(event: {
  roundNumber: number
  tableNumber: number | null
}) {
  return event.tableNumber === null
    ? `(round ${event.roundNumber})`
    : `(round ${event.roundNumber}, table ${event.tableNumber})`
}

function formatScoreline(lines: Array<ResultLine>) {
  const first = lines.at(0)
  const second = lines.at(1)
  if (!first || !second) {
    return 'a match result'
  }
  const scoreline = formatGameScoreline(
    first.gameWins,
    second.gameWins,
    first.gameDraws,
  )
  return `${displayPlayerName(first.playerName)} ${scoreline} ${displayPlayerName(second.playerName)}`
}

function formatTimestamp(creationTime: number) {
  return new Date(creationTime).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}
