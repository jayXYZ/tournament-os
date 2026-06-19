import { Link, useNavigate  } from '@tanstack/react-router'
import { ArrowRight, CalendarDays } from 'lucide-react'

import type { Tournament } from './types'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function TournamentTable({
  tournaments,
}: {
  tournaments: Array<Tournament> | undefined
}) {
  if (tournaments === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading tournaments</CardTitle>
          <CardDescription>
            Fetching events for the selected organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-12" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (tournaments.length === 0) {
    return (
      <Card>
        <CardContent>
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarDays />
              </EmptyMedia>
              <EmptyTitle>No upcoming tournaments</EmptyTitle>
              <EmptyDescription>
                Future tournaments for this organization will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tournament schedule</CardTitle>
        <CardDescription>Upcoming organization tournaments.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>Tournament</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Start date</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tournaments.map((tournament) => (
              <TournamentRow key={tournament._id} tournament={tournament} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function TournamentRow({ tournament }: { tournament: Tournament }) {
  const navigate = useNavigate()
  const href = `/admin/tournaments/${tournament._id}`

  return (
    <TableRow onClick={() => navigate({ to: href })} className="cursor-pointer">
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          <p className="font-medium text-foreground">{tournament.name}</p>
          {tournament.isTestEvent ? (
            <Badge className="bg-green-200 text-green-700 dark:bg-green-950 dark:text-green-300">
              Test
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="capitalize">{tournament.format}</TableCell>
      <TableCell>
        {dateFormatter.format(new Date(tournament.startDate))}
      </TableCell>
      <TableCell>{tournament.playerCapacity}</TableCell>
      <TableCell className="capitalize">{tournament.status}</TableCell>
      <TableCell className="text-right">
        <Button
          asChild
          type="button"
          variant="outline"
          onClick={(event) => event.stopPropagation()}
        >
          <Link to={href}>
            Manage
            <ArrowRight />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  )
}
