import { useState } from 'react'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { Ticket, UserRoundX } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type {
  Doc,
  Id,
} from '@tournament-os/backend/convex/_generated/dataModel'
import {
  entryStatusBadgeVariant,
  paymentBadge,
} from '@/components/organizer-workspace/paid-event/roster-badges'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { LoadMoreButton } from '@/components/shared/load-more-button'
import { TableEmptyState } from '@/components/shared/table-empty-state'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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
import { useBusyAction } from '@/hooks/use-busy-action'

const BADGE_PAGE_SIZE = 25

type BadgeRow = {
  registration: Doc<'conventionRegistrations'>
  playerName: string | undefined
  paymentStatus: Doc<'paymentOrders'>['status'] | null
}

export function BadgeRosterView({
  conventionId,
}: {
  conventionId: Id<'conventions'>
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.conventions.registrations.listBadgePage,
    { conventionId },
    { initialNumItems: BADGE_PAGE_SIZE },
  )

  const [searchTerm, setSearchTerm] = useState('')
  const search = searchTerm.trim()
  const searching = search !== ''
  const searchResults = useQuery(
    api.conventions.registrations.searchBadges,
    searching ? { conventionId, search } : 'skip',
  )

  const rows: Array<BadgeRow> | undefined = searching
    ? (searchResults ?? [])
    : status === 'LoadingFirstPage'
      ? undefined
      : results

  const showPaymentColumn =
    rows?.some((row) => row.paymentStatus !== null) ?? false

  return (
    <section className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Badge registrations</CardTitle>
          <CardDescription>
            Everyone registered for the convention itself. Event rosters live on
            each tournament.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 max-w-xs">
            <Input
              aria-label="Search badge holders"
              placeholder="Search badge holders"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
            />
          </div>
          {rows === undefined ? (
            <TableLoadingSkeleton rows={4} />
          ) : rows.length === 0 ? (
            <TableEmptyState
              icon={Ticket}
              title={searching ? 'No matches' : 'No badges yet'}
              description={
                searching
                  ? 'No badge holder matches that name.'
                  : 'Badges appear here as people register for the convention.'
              }
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attendee</TableHead>
                  <TableHead>Status</TableHead>
                  {showPaymentColumn ? <TableHead>Payment</TableHead> : null}
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <BadgeRosterRow
                    key={row.registration._id}
                    row={row}
                    showPaymentColumn={showPaymentColumn}
                  />
                ))}
              </TableBody>
            </Table>
          )}
          {!searching ? (
            <LoadMoreButton
              className="mt-4"
              status={status}
              onLoadMore={() => loadMore(BADGE_PAGE_SIZE)}
              label="Load older registrations"
              loadingLabel="Loading older registrations…"
            />
          ) : null}
        </CardContent>
      </Card>
    </section>
  )
}

function BadgeRosterRow({
  row,
  showPaymentColumn,
}: {
  row: BadgeRow
  showPaymentColumn: boolean
}) {
  const removeBadge = useMutation(api.conventions.registrations.removeBadge)
  const { run } = useBusyAction()
  const { registration } = row
  const removable =
    registration.entryStatus === 'confirmed' ||
    registration.entryStatus === 'pending'

  return (
    <TableRow>
      <TableCell className="font-medium">
        {row.playerName ?? 'Unknown player'}
      </TableCell>
      <TableCell>
        <Badge variant={entryStatusBadgeVariant[registration.entryStatus]}>
          {registration.entryStatus}
        </Badge>
      </TableCell>
      {showPaymentColumn ? (
        <TableCell>
          {row.paymentStatus ? (
            <Badge variant={paymentBadge[row.paymentStatus].variant}>
              {paymentBadge[row.paymentStatus].label}
            </Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </TableCell>
      ) : null}
      <TableCell className="text-right">
        {removable ? (
          <ConfirmActionDialog
            trigger={
              <Button type="button" variant="ghost" size="sm">
                <UserRoundX data-icon="inline-start" />
                Remove
              </Button>
            }
            icon={<UserRoundX />}
            destructive
            title={`Remove ${row.playerName ?? 'this attendee'}?`}
            description="Their badge is cancelled and any badge payment is refunded in full, with the organization absorbing the payment processing fee. Their registrations for individual events are not affected."
            actionLabel="Remove badge"
            failureMessage="Could not remove the badge."
            onConfirm={() =>
              run(async () => {
                await removeBadge({ registrationId: registration._id })
                toast.success('Badge removed.')
              }, 'Could not remove the badge.')
            }
          />
        ) : null}
      </TableCell>
    </TableRow>
  )
}
