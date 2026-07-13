import { usePaginatedQuery } from 'convex/react'
import { ScrollText } from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

export function AuditLogView({ tournamentId }: { tournamentId: string }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.tournaments.auditLog.listAuditEvents,
    { tournamentId: tournamentId as Id<'tournaments'> },
    { initialNumItems: PAGE_SIZE },
  )

  return (
    <section className="flex flex-col gap-4">
      <WorkspacePageHeader eyebrow="Tournament manager" title="Event log" />
      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
          <CardDescription>
            Every result entry, edit, drop, and lifecycle change, newest first
            — for resolving disputes after the fact.
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
              {status !== 'Exhausted' && (
                <div className="mt-4 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={status === 'LoadingMore'}
                    onClick={() => loadMore(PAGE_SIZE)}
                  >
                    Load older entries
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function AuditEventItem({ row }: { row: AuditEventRow }) {
  const isEdit =
    row.event.type === 'match_result_recorded' &&
    row.event.previousResult !== null

  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={row.actorRole === 'organizer' ? 'default' : 'secondary'}>
          {row.actorRole === 'organizer' ? 'Organizer' : 'Player'}
        </Badge>
        {isEdit && <Badge variant="destructive">Result edit</Badge>}
        <span className="text-sm font-medium">
          {row.actorName ?? 'Unknown user'}
        </span>
        <span
          className="ml-auto text-xs text-muted-foreground"
          title={new Date(row._creationTime).toISOString()}
        >
          {formatTimestamp(row._creationTime)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{describeEvent(row)}</p>
      {isEdit && row.event.type === 'match_result_recorded' && (
        <p className="text-sm text-muted-foreground">
          Previous result: {formatScoreline(row.event.previousResult!)}
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
    case 'match_result_confirmed':
      return `Confirmed the reported result ${matchLocation(event)}`
    case 'player_registered':
      return `${lineName(event.player.playerName)} registered for the event`
    case 'registration_cancelled':
      return `${lineName(event.player.playerName)} cancelled their registration`
    case 'player_dropped':
      return row.actorRole === 'organizer'
        ? `Dropped ${lineName(event.player.playerName)} from the event`
        : `${lineName(event.player.playerName)} dropped from the event`
    case 'player_reinstated':
      return `Reinstated ${lineName(event.player.playerName)}`
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
  }
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
  return `${lineName(first.playerName)} ${first.gameWins}–${second.gameWins} ${lineName(second.playerName)}`
}

function lineName(name: string | null) {
  return name ?? 'Unknown player'
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
