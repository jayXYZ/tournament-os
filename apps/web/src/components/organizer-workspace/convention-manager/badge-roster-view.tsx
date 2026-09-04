import { useEffect, useRef, useState } from 'react'
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
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useBusyAction } from '@/hooks/use-busy-action'
import { cn } from '@/lib/utils'

const BADGE_PAGE_SIZE = 25

type BadgeRow = {
  registration: Doc<'conventionRegistrations'>
  playerName: string | undefined
  ticketTypeName: string | null
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
  // Keep the previous matches on screen while a keystroke's query is in
  // flight so the table doesn't flash "No matches" between results — the
  // same cache the tournament roster keeps (registrations-view.tsx). It is
  // only valid for the current uninterrupted search session: emptying the
  // box clears it, and it is stamped with the convention it belongs to so
  // a convention switch mid-search can't show another roster's rows.
  const lastSearchResults = useRef<{
    conventionId: Id<'conventions'>
    rows: Array<BadgeRow>
  } | null>(null)
  useEffect(() => {
    if (searchResults !== undefined) {
      lastSearchResults.current = { conventionId, rows: searchResults }
    }
  }, [searchResults, conventionId])

  function handleSearchTermChange(value: string) {
    if (value.trim() === '') {
      // Emptying the box ends the search session; the next search must
      // start from the pending state, not ghost rows from the last term.
      lastSearchResults.current = null
    }
    setSearchTerm(value)
  }

  const cachedSearchRows =
    lastSearchResults.current !== null &&
    lastSearchResults.current.conventionId === conventionId
      ? lastSearchResults.current.rows
      : undefined
  // True while the rows on screen are the previous term's, not yet
  // confirmed matches for what's currently typed.
  const searchPending = searching && searchResults === undefined

  const rows: Array<BadgeRow> | undefined = searching
    ? // On a cache miss the fallback is [] (with searchPending true), not
      // undefined: undefined would swap in the loading skeleton and unmount
      // the search input mid-typing.
      (searchResults ?? cachedSearchRows ?? [])
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
              onChange={(event) => handleSearchTermChange(event.target.value)}
            />
          </div>
          {rows === undefined ? (
            <TableLoadingSkeleton rows={4} />
          ) : rows.length === 0 ? (
            // Until the current term's results arrive an empty page is
            // inconclusive, so don't yet claim nobody matches.
            <TableEmptyState
              icon={Ticket}
              title={
                searchPending
                  ? 'Searching badge holders…'
                  : searching
                    ? 'No matches'
                    : 'No badges yet'
              }
              description={
                searchPending
                  ? 'Matches appear as soon as the search completes.'
                  : searching
                    ? 'No badge holder matches that name.'
                    : 'Badges appear here as people register for the convention.'
              }
            />
          ) : (
            <div className="flex flex-col gap-2">
              {searchPending ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Spinner className="size-3" />
                  Showing previous results while your search updates…
                </p>
              ) : null}
              <Table className={cn(searchPending && 'opacity-60')}>
                <TableHeader>
                  <TableRow>
                    <TableHead>Attendee</TableHead>
                    <TableHead>Ticket</TableHead>
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
                      actionsDisabled={searchPending}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
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
  actionsDisabled,
}: {
  row: BadgeRow
  showPaymentColumn: boolean
  // True while `row` is a stale search result (a previous term's row kept
  // on screen to avoid flicker) rather than a confirmed match for what's
  // currently typed. It is still a real registration, but it may not be
  // the one the organizer thinks they're looking at, so the destructive
  // action is held off until the current term's results arrive.
  actionsDisabled: boolean
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
        {row.ticketTypeName ?? <span className="text-muted-foreground">—</span>}
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={actionsDisabled}
              >
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
