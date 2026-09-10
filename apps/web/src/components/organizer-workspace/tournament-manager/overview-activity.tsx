import { Link } from '@tanstack/react-router'
import { usePaginatedQuery } from 'convex/react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { describeAuditEvent } from './audit-event-text'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const RECENT_COUNT = 6

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatRecentTime(creationTime: number) {
  const date = new Date(creationTime)
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  return (sameDay ? timeFormatter : dateTimeFormatter).format(date)
}

// The last few things that happened, in the Activity tab's own words, so an
// organizer can answer "did table 3 report?" without leaving the overview.
export function RecentActivityCard({
  tournamentId,
  publicCode,
}: {
  tournamentId: Id<'tournaments'>
  publicCode: string
}) {
  const { results, status } = usePaginatedQuery(
    api.tournaments.auditLog.listAuditEvents,
    { tournamentId },
    { initialNumItems: RECENT_COUNT },
  )
  const recent = results.slice(0, RECENT_COUNT)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent</CardTitle>
        <CardDescription>
          <Link
            to="/admin/tournaments/$tournamentId/log"
            params={{ tournamentId: publicCode }}
            className="underline underline-offset-4 hover:text-foreground"
          >
            All activity
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {status === 'LoadingFirstPage' ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5" />
            <Skeleton className="h-5" />
            <Skeleton className="h-5" />
          </div>
        ) : recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing has happened yet. Actions on this tournament will appear
            here.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((row) => (
              <li
                key={row._id}
                className="flex items-baseline gap-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 text-muted-foreground">
                  {describeAuditEvent(row)}
                </span>
                <time
                  dateTime={new Date(row._creationTime).toISOString()}
                  className="shrink-0 text-xs tabular-nums text-muted-foreground"
                >
                  {formatRecentTime(row._creationTime)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
