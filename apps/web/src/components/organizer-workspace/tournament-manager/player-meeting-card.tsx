import { useQuery } from 'convex/react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { displayPlayerName } from '@tournament-os/core'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

type MeetingSeating = FunctionReturnType<
  typeof api.tournaments.playerMeeting.listPlayerMeetingSeats
>
type MeetingSeat = MeetingSeating['seats'][number]

// The alphabetical seating snapshot for a phase's player meeting. Seats are
// immutable once the meeting starts; drops made in the Registrations view
// strike through here live so the organizer can call attendance from this
// list.
export function PlayerMeetingCard({
  phaseId,
  meetingStatus,
}: {
  phaseId: Id<'tournamentPhases'>
  meetingStatus: 'in_progress' | 'completed'
}) {
  const seating = useQuery(
    api.tournaments.playerMeeting.listPlayerMeetingSeats,
    { phaseId },
  )

  const tables = new Map<number, Array<MeetingSeat>>()
  for (const seat of seating?.seats ?? []) {
    const seatedAt = tables.get(seat.tableNumber) ?? []
    seatedAt.push(seat)
    tables.set(seat.tableNumber, seatedAt)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Player meeting
          {meetingStatus === 'in_progress' ? (
            <Badge>In progress</Badge>
          ) : (
            <Badge variant="secondary">Completed</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Players seated alphabetically for attendance and announcements. Drop
          no-shows from the Registrations view; dropped players are struck
          through here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {seating === undefined ? (
          <TableLoadingSkeleton />
        ) : (
          <Table className="min-w-[420px]">
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Table</TableHead>
                <TableHead>Players</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...tables.entries()].map(([tableNumber, seats]) => (
                <TableRow key={tableNumber}>
                  <TableCell className="font-medium tabular-nums">
                    {tableNumber}
                  </TableCell>
                  <TableCell>
                    {seats.map((seat) => (
                      <p
                        key={seat._id}
                        className={cn(
                          'font-medium text-foreground',
                          seat.registrationStatus !== 'active' &&
                            'text-muted-foreground line-through',
                        )}
                      >
                        {displayPlayerName(seat.playerName)}
                        {seat.registrationStatus !== 'active' ? (
                          <Badge variant="outline" className="ml-2 no-underline">
                            Dropped
                          </Badge>
                        ) : null}
                      </p>
                    ))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
