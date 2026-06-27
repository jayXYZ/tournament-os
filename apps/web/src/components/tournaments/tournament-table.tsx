import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowRight,
  CalendarDays,
  Swords,
  Ticket,
  UserRound,
} from 'lucide-react'
import {
  TournamentStatusBadge,
  formatTournamentDateShort,
} from './tournament-display'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'

import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type TournamentTableVariant = 'public' | 'registered' | 'manage'

export type TournamentTableItem = {
  key: string
  organizationName?: string | null
  registeredCount?: number
  registration?: Doc<'tournamentRegistrations'>
  tournament: Doc<'tournaments'>
}

export function TournamentTable({
  items,
  variant,
}: {
  items: Array<TournamentTableItem> | undefined
  variant: TournamentTableVariant
}) {
  if (items === undefined) {
    const copy = loadingCopy[variant]
    return (
      <Card>
        <CardHeader>
          <CardTitle>{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <TableLoadingSkeleton rows={variant === 'registered' ? 2 : 3} />
        </CardContent>
      </Card>
    )
  }

  if (items.length === 0) {
    return <TournamentTableEmpty variant={variant} />
  }

  const copy = populatedCopy[variant]
  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table
          className={variant === 'manage' ? 'min-w-[760px]' : 'min-w-[900px]'}
        >
          <TournamentTableHeader variant={variant} />
          <TableBody>
            {items.map((item) => (
              <TournamentTableRow
                key={item.key}
                item={item}
                variant={variant}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

const loadingCopy: Record<
  TournamentTableVariant,
  { description: string; title: string }
> = {
  public: {
    title: 'Loading tournaments',
    description: 'Fetching public events available to players.',
  },
  registered: {
    title: 'My tournaments',
    description: 'Checking your ongoing and upcoming registrations.',
  },
  manage: {
    title: 'Loading tournaments',
    description: 'Fetching events for the selected organization.',
  },
}

const populatedCopy: Record<
  TournamentTableVariant,
  { description: string; title: string }
> = {
  public: {
    title: 'Public tournament schedule',
    description: 'Upcoming events published by tournament organizers.',
  },
  registered: {
    title: 'My tournaments',
    description: 'Ongoing and upcoming events you are registered for.',
  },
  manage: {
    title: 'Tournament schedule',
    description: 'Upcoming organization tournaments.',
  },
}

function TournamentTableEmpty({
  variant,
}: {
  variant: TournamentTableVariant
}) {
  if (variant === 'registered') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My tournaments</CardTitle>
          <CardDescription>
            You are not registered for any upcoming events yet. Pick one from
            the schedule below to get started.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const empty = (
    <Empty
      className={
        variant === 'public' ? 'min-h-80 border bg-card' : 'min-h-64'
      }
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {variant === 'public' ? (
            <UserRound aria-hidden="true" />
          ) : (
            <CalendarDays aria-hidden="true" />
          )}
        </EmptyMedia>
        <EmptyTitle>No upcoming tournaments</EmptyTitle>
        <EmptyDescription>
          {variant === 'public'
            ? 'Public tournaments will appear here once an organizer publishes future events.'
            : 'Future tournaments for this organization will appear here.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )

  if (variant === 'public') {
    return empty
  }

  return (
    <Card>
      <CardContent>{empty}</CardContent>
    </Card>
  )
}

function TournamentTableHeader({
  variant,
}: {
  variant: TournamentTableVariant
}) {
  const showOrganizer = variant !== 'manage'

  return (
    <TableHeader>
      <TableRow>
        <TableHead>Tournament</TableHead>
        {showOrganizer ? <TableHead>Organizer</TableHead> : null}
        <TableHead>Format</TableHead>
        <TableHead>Start date</TableHead>
        <TableHead>Players</TableHead>
        <TableHead>Status</TableHead>
        <TableHead className="text-right">Action</TableHead>
      </TableRow>
    </TableHeader>
  )
}

function TournamentTableRow({
  item,
  variant,
}: {
  item: TournamentTableItem
  variant: TournamentTableVariant
}) {
  const navigate = useNavigate()
  const { tournament } = item
  const publicCode = String(tournament.publicCode)
  const manageHref = `/admin/tournaments/${publicCode}`
  const isManage = variant === 'manage'
  const showOrganizer = !isManage

  return (
    <TableRow
      className={isManage ? 'cursor-pointer' : undefined}
      onClick={isManage ? () => navigate({ to: manageHref }) : undefined}
    >
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          <p className="font-medium text-foreground">{tournament.name}</p>
          {tournament.isTestEvent ? (
            <Badge variant="outline">Test</Badge>
          ) : null}
        </div>
      </TableCell>
      {showOrganizer ? (
        <TableCell>{item.organizationName ?? '—'}</TableCell>
      ) : null}
      <TableCell className="capitalize">{tournament.format}</TableCell>
      <TableCell>{formatTournamentDateShort(tournament.startDate)}</TableCell>
      <TableCell className="tabular-nums">
        {item.registeredCount ?? 0}
        <span className="text-muted-foreground">
          {' / '}
          {tournament.playerCapacity}
        </span>
      </TableCell>
      <TableCell>
        <TournamentStatusBadge status={tournament.status} />
      </TableCell>
      <TableCell className="text-right">
        <TournamentTableAction
          manageHref={manageHref}
          publicCode={publicCode}
          tournament={tournament}
          variant={variant}
        />
      </TableCell>
    </TableRow>
  )
}

function TournamentTableAction({
  manageHref,
  publicCode,
  tournament,
  variant,
}: {
  manageHref: string
  publicCode: string
  tournament: Doc<'tournaments'>
  variant: TournamentTableVariant
}) {
  if (variant === 'manage') {
    return (
      <Button
        asChild
        type="button"
        variant="outline"
        onClick={(event) => event.stopPropagation()}
      >
        <Link to={manageHref}>
          Manage
          <ArrowRight data-icon="inline-end" />
        </Link>
      </Button>
    )
  }

  if (variant === 'registered') {
    if (tournament.status === 'in_progress') {
      return (
        <Button asChild type="button">
          <Link
            to="/tournaments/$tournamentId/play"
            params={{ tournamentId: publicCode }}
          >
            <Swords data-icon="inline-start" />
            Open player controller
          </Link>
        </Button>
      )
    }

    return (
      <Button asChild type="button" variant="outline">
        <Link
          to="/tournaments/$tournamentId"
          params={{ tournamentId: publicCode }}
        >
          <Ticket data-icon="inline-start" />
          View event
        </Link>
      </Button>
    )
  }

  return (
    <Button asChild type="button" variant="outline">
      <Link
        to="/tournaments/$tournamentId"
        params={{ tournamentId: publicCode }}
      >
        View details
      </Link>
    </Button>
  )
}
