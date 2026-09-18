import { usePaginatedQuery } from 'convex/react'
import { ScrollText } from 'lucide-react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import {
  describeAuditEvent,
  formatAuditScoreline,
  formatAuditTimestamp,
} from './audit-event-text'
import type { AuditEventRow } from './audit-event-text'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'
import { LoadMoreButton } from '@/components/shared/load-more-button'
import { Badge } from '@/components/ui/badge'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'

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
      <div>
        <h2 className="text-sm font-medium">Activity</h2>
        <p className="text-xs/relaxed text-muted-foreground">
          Every result entry, edit, drop, and lifecycle change, newest first —
          for resolving disputes after the fact.
        </p>
      </div>
      <div>
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
      </div>
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
          {formatAuditTimestamp(row._creationTime)}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{describeAuditEvent(row)}</p>
      {previousResult !== null && (
        <p className="text-sm text-muted-foreground">
          Previous result: {formatAuditScoreline(previousResult)}
        </p>
      )}
    </li>
  )
}
