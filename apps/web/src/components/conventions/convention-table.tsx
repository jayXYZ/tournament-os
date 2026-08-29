import { useNavigate } from '@tanstack/react-router'
import { CalendarDays, Ticket } from 'lucide-react'

import { formatConventionDateRange } from './convention-display'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { TournamentLifecycleBadge } from '@/components/tournaments'
import { TableEmptyState } from '@/components/shared/table-empty-state'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
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

export type ConventionTableItem = {
  key: string
  organizationName?: string | null
  registeredCount?: number
  convention: Doc<'conventions'>
}

const copy = {
  manage: {
    title: 'Conventions',
    description: 'Umbrella events that hold tournaments and sell badges.',
    emptyTitle: 'No conventions yet',
    emptyDescription: 'Create one to group tournaments under it.',
  },
  public: {
    title: 'Upcoming conventions',
    description: 'Multi-event weekends open for badge registration.',
    emptyTitle: 'No upcoming conventions',
    emptyDescription: 'Check back soon for multi-event weekends.',
  },
} as const

export function ConventionTable({
  items,
  variant,
}: {
  items: Array<ConventionTableItem> | undefined
  variant: 'manage' | 'public'
}) {
  const navigate = useNavigate()
  const { title, description, emptyTitle, emptyDescription } = copy[variant]

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {items === undefined ? (
          <TableLoadingSkeleton rows={3} />
        ) : items.length === 0 ? (
          <TableEmptyState
            icon={CalendarDays}
            title={emptyTitle}
            description={emptyDescription}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Convention</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="inline-flex items-center gap-1">
                    <Ticket className="size-3.5" />
                    Badges
                  </span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map(
                ({ key, convention, organizationName, registeredCount }) => (
                  <TableRow
                    key={key}
                    className="cursor-pointer"
                    onClick={() =>
                      void navigate({
                        to:
                          variant === 'manage'
                            ? '/admin/conventions/$conventionId'
                            : '/conventions/$conventionId',
                        params: { conventionId: String(convention.publicCode) },
                      })
                    }
                  >
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{convention.name}</span>
                        {organizationName ? (
                          <span className="text-xs text-muted-foreground">
                            {organizationName}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatConventionDateRange(
                        convention.startDate,
                        convention.endDate,
                      )}
                    </TableCell>
                    <TableCell>
                      <TournamentLifecycleBadge
                        lifecycle={convention.lifecycle}
                      />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {registeredCount ?? convention.confirmedRegistrationCount}
                      {' / '}
                      {convention.playerCapacity}
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
