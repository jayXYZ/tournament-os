import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import {
  ClipboardList,
  FlaskConical,
  Hourglass,
  MoreHorizontal,
  Settings2,
  UserCheck,
  UserMinus,
  UserX,
} from 'lucide-react'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { displayPlayerName } from '@paper-pairings/core'
import {
  MALFORMED_REGISTRATION_STATUS,
  effectiveRegistrationStatus,
} from '@paper-pairings/shared/registration-status'
import { toast } from 'sonner'
import type { ColumnDef } from '@tanstack/react-table'
import type {
  Doc,
  Id,
} from '@paper-pairings/backend/convex/_generated/dataModel'
import type { StatusTone } from '@/components/shared/status-dot'
import type {
  DataTableFilterDef,
  DataTableFilterOption,
} from '@/components/ui/data-table-toolbar'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { LoadMoreButton } from '@/components/shared/load-more-button'
import { TableEmptyState } from '@/components/shared/table-empty-state'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { StatusDot } from '@/components/shared/status-dot'
import { Button } from '@/components/ui/button'
import {
  DataTable,
  DataTableColumnHeader,
  oneOfFilter,
} from '@/components/ui/data-table'
import { DataTableToolbar } from '@/components/ui/data-table-toolbar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'
import { cn } from '@/lib/utils'

type RegistrationRow = {
  registration: Doc<'tournamentRegistrations'>
  playerName: string | undefined
  // Server-computed effect of dropRegistration on this row, null when the
  // action is unavailable; the client never re-derives the lifecycle rules.
  dropEffect: 'cancel' | 'drop' | null
  // Whether that drop would concede the row's unfinished match in the open
  // round — the same predicate the drop applies, never re-derived here.
  dropWouldConcede: boolean
  // The entry-review actions available on this row (null when unavailable),
  // from the same projections the verbs enforce, so the menu offers exactly
  // what the server would accept. approveEffect is named by the state the
  // approval would lift the row out of — the same fact the server's
  // previousEntryStatus audit field records.
  approveEffect: 'pending' | 'waitlisted' | 'rejected' | null
  rejectEffect: 'decline' | 'remove' | 'bar' | null
  waitlistEffect: 'waitlist' | null
  // The newest order's status on paid events; null on free events or when
  // the player has no order.
  paymentStatus: Doc<'paymentOrders'>['status'] | null
}

type PaymentStatus = NonNullable<RegistrationRow['paymentStatus']>

const paymentPresentation: Record<
  PaymentStatus,
  { label: string; tone: StatusTone }
> = {
  requires_payment: { label: 'Payment due', tone: 'warning' },
  awaiting_payment: { label: 'In checkout', tone: 'warning' },
  paid: { label: 'Paid', tone: 'live' },
  expired: { label: 'Unpaid', tone: 'muted' },
  failed: { label: 'Failed', tone: 'danger' },
  canceled: { label: 'Unpaid', tone: 'muted' },
  refunded: { label: 'Refunded', tone: 'muted' },
  partially_refunded: { label: 'Entry refunded', tone: 'muted' },
  disputed: { label: 'Disputed', tone: 'danger' },
}

type RegistrationStatus =
  | Doc<'tournamentRegistrations'>['entryStatus']
  | NonNullable<Doc<'tournamentRegistrations'>['participationStatus']>
  | typeof MALFORMED_REGISTRATION_STATUS

const REGISTRATION_PAGE_SIZE = 100

// Status is a dot and a word (StatusDot): green for a seat in good standing,
// amber for a row waiting on the organizer, red for one the organizer or the
// rules removed, grey for the rest.
const statusTone: Record<RegistrationStatus, StatusTone> = {
  active: 'live',
  pending: 'warning',
  waitlisted: 'warning',
  confirmed: 'live',
  cancelled: 'muted',
  rejected: 'danger',
  eliminated: 'muted',
  dropped: 'danger',
  disqualified: 'danger',
  // Malformed data only (see effectiveRegistrationStatus); flagged distinctly
  // rather than folded into "confirmed" so it can't misread as good standing.
  [MALFORMED_REGISTRATION_STATUS]: 'warning',
}

const toneDotClassName: Record<StatusTone, string> = {
  live: 'bg-round-live',
  accent: 'bg-accent-brand',
  neutral: 'bg-foreground',
  muted: 'bg-muted-foreground',
  warning: 'bg-round-pairings',
  danger: 'bg-destructive',
}

// The filter chips offer the statuses a roster can actually hold; the
// malformed marker is diagnostic and stays out of the list.
const statusFilterOptions: Array<DataTableFilterOption> = (
  [
    'confirmed',
    'active',
    'pending',
    'waitlisted',
    'cancelled',
    'rejected',
    'eliminated',
    'dropped',
    'disqualified',
  ] satisfies Array<
    Exclude<RegistrationStatus, typeof MALFORMED_REGISTRATION_STATUS>
  >
).map((status) => ({
  value: status,
  label: status.charAt(0).toUpperCase() + status.slice(1),
  dotClassName: toneDotClassName[statusTone[status]],
}))

const paymentFilterOptions: Array<DataTableFilterOption> = (
  Object.keys(paymentPresentation) as Array<PaymentStatus>
).map((status) => ({
  value: status,
  label: paymentPresentation[status].label,
  dotClassName: toneDotClassName[paymentPresentation[status].tone],
}))

export function RegistrationsView({
  tournamentId,
}: {
  tournamentId: Id<'tournaments'>
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.tournaments.registrations.listRegistrationPage,
    {
      tournamentId,
    },
    { initialNumItems: REGISTRATION_PAGE_SIZE },
  )
  const setup = useQuery(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId,
  })

  // The paginated list only holds the pages loaded so far, so filtering it
  // client-side would falsely report a player on an unloaded page as "no
  // match". While a term is active the table instead shows a server-side
  // search over the full history, bounded to one page of best matches.
  const [searchTerm, setSearchTerm] = useState('')
  const search = searchTerm.trim()
  const searching = search !== ''
  const searchResults = useQuery(
    api.tournaments.registrations.searchRegistrations,
    searching ? { tournamentId, search } : 'skip',
  )
  // Keep the previous matches on screen while a keystroke's query is in
  // flight so the table doesn't flash empty between results. The cache is
  // only valid for the current uninterrupted search session: emptying the
  // box clears it (handleSearchTermChange), and it is stamped with the
  // tournament it belongs to so a tournament switch mid-search can't show
  // another roster's rows. useQuery's value is looked up by the current
  // render's args, so `searchResults` here is always rows for exactly this
  // render's { tournamentId, search } — the stamp can't mislabel.
  const lastSearchResults = useRef<{
    tournamentId: Id<'tournaments'>
    rows: Array<RegistrationRow>
  } | null>(null)
  useEffect(() => {
    if (searchResults !== undefined) {
      lastSearchResults.current = { tournamentId, rows: searchResults }
    }
  }, [searchResults, tournamentId])

  function handleSearchTermChange(value: string) {
    if (value.trim() === '') {
      // Emptying the box ends the search session; the next search must
      // start from the "Searching registrations…" state, not ghost rows
      // from the previous term.
      lastSearchResults.current = null
    }
    setSearchTerm(value)
  }

  const cachedSearchRows =
    lastSearchResults.current !== null &&
    lastSearchResults.current.tournamentId === tournamentId
      ? lastSearchResults.current.rows
      : undefined

  const rows = searching
    ? // On a cache miss the fallback is [] (with searchPending true), not
      // undefined: undefined would swap in the full loading skeleton and
      // unmount the search input mid-typing.
      (searchResults ?? cachedSearchRows ?? [])
    : status === 'LoadingFirstPage'
      ? undefined
      : results

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-medium">Player registrations</h2>
        <p className="text-xs/relaxed text-muted-foreground">
          Review and manage the players signed up for this tournament.
        </p>
      </div>
      <div>
        <RegistrationsTable
          registrations={rows}
          searchTerm={searchTerm}
          onSearchTermChange={handleSearchTermChange}
          searchPending={searching && searchResults === undefined}
          showPaymentColumn={(setup?.tournament.entryFeeCents ?? 0) > 0}
          actions={<RegistrationSettingsMenu tournament={setup?.tournament} />}
        />
        {!searching ? (
          <LoadMoreButton
            className="mt-4"
            status={status}
            onLoadMore={() => loadMore(REGISTRATION_PAGE_SIZE)}
            label="Load older registrations"
            loadingLabel="Loading older registrations…"
          />
        ) : null}
      </div>
    </section>
  )
}

function RegistrationSettingsMenu({
  tournament,
}: {
  tournament: Doc<'tournaments'> | undefined
}) {
  const seedTestPlayers = useMutation(api.tournaments.testing.seedTestPlayers)
  const { busy, run } = useBusyAction()

  const activeRegistrations = tournament?.confirmedRegistrationCount ?? 0
  const remainingSeats =
    tournament === undefined
      ? 0
      : Math.max(tournament.playerCapacity - activeRegistrations, 0)
  const canGenerate =
    tournament !== undefined && tournament.isTestEvent && remainingSeats > 0

  async function handleGenerateTestUsers() {
    if (!tournament) {
      return
    }

    await run(async () => {
      const { addedCount } = await seedTestPlayers({
        tournamentId: tournament._id,
        count: remainingSeats,
      })
      toast.success(
        addedCount > 0
          ? `${addedCount} test ${addedCount === 1 ? 'user' : 'users'} generated.`
          : 'Tournament is already at capacity.',
      )
    }, 'Could not generate test users.')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Registration settings"
        >
          {busy ? <Spinner /> : <Settings2 />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={!canGenerate || busy}
            onSelect={() => void handleGenerateTestUsers()}
          >
            <FlaskConical />
            Generate Test Users
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// A factory (rather than a static array) so the actions column can be
// disabled while the visible rows are stale search results — see
// RegistrationsTable's `actionsDisabled` usage below.
function getRegistrationColumns({
  actionsDisabled,
  showPaymentColumn,
}: {
  actionsDisabled: boolean
  showPaymentColumn: boolean
}): Array<ColumnDef<RegistrationRow>> {
  const paymentColumn: Array<ColumnDef<RegistrationRow>> = showPaymentColumn
    ? [
        {
          id: 'payment',
          accessorFn: (row) => row.paymentStatus ?? '',
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Payment" />
          ),
          filterFn: oneOfFilter,
          meta: { className: 'w-36' },
          cell: ({ row }) => {
            const paymentStatus = row.original.paymentStatus
            if (!paymentStatus) {
              return <span className="text-muted-foreground">—</span>
            }
            const { label, tone } = paymentPresentation[paymentStatus]
            return <StatusDot tone={tone}>{label}</StatusDot>
          },
        },
      ]
    : []
  return [
    {
      id: 'player',
      accessorFn: (row) => displayPlayerName(row.playerName),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Player" />
      ),
      // Greedy column absorbs width variance so the columns after it stay
      // put as names change length across pages.
      meta: { className: 'w-full' },
      cell: ({ row }) => (
        <p className="font-medium text-foreground">
          {displayPlayerName(row.original.playerName)}
        </p>
      ),
    },
    {
      id: 'status',
      accessorFn: (row) => effectiveRegistrationStatus(row.registration),
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title="Status" />
      ),
      filterFn: oneOfFilter,
      // Fixed width keeps the column from shifting as the longest visible
      // status label (e.g. "disqualified" vs "active") changes between
      // pages.
      meta: { className: 'w-32' },
      cell: ({ row }) => {
        const status = effectiveRegistrationStatus(row.original.registration)
        return (
          <StatusDot tone={statusTone[status]} className="capitalize">
            {status}
          </StatusDot>
        )
      },
    },
    ...paymentColumn,
    {
      id: 'actions',
      header: 'Manage',
      enableSorting: false,
      meta: { className: 'text-right' },
      cell: ({ row }) => (
        <ManagePlayerMenu row={row.original} disabled={actionsDisabled} />
      ),
    },
  ]
}

function RegistrationsTable({
  registrations,
  searchTerm,
  onSearchTermChange,
  searchPending,
  showPaymentColumn,
  actions,
}: {
  registrations: Array<RegistrationRow> | undefined
  searchTerm: string
  onSearchTermChange: (value: string) => void
  searchPending: boolean
  showPaymentColumn: boolean
  actions?: React.ReactNode
}) {
  const searching = searchTerm.trim() !== ''
  // `registrations` may still be the previous term's rows, kept on screen
  // (via RegistrationsView's lastSearchResults cache) so the table doesn't
  // flash empty on every keystroke. While that's true, those rows are not
  // yet confirmed matches for the current term, so dim them, say so, and
  // block the destructive row action until the current term's real results
  // arrive.
  const columns = useMemo(
    () =>
      getRegistrationColumns({
        actionsDisabled: searchPending,
        showPaymentColumn,
      }),
    [searchPending, showPaymentColumn],
  )

  if (registrations === undefined) {
    return <TableLoadingSkeleton />
  }

  // The toolbar stays mounted on an empty roster too: that is when the
  // organizer reaches for the settings menu, and while searching an empty
  // page means "no match", not "no registrations".
  const noResultsLabel = searching ? (
    searchPending ? (
      // Until the current term's results arrive an empty page is
      // inconclusive, so don't yet claim the player doesn't exist.
      'Searching registrations…'
    ) : (
      'No players match your search.'
    )
  ) : registrations.length === 0 ? (
    <TableEmptyState
      icon={ClipboardList}
      title="No registrations yet"
      description="Players who sign up for this tournament will appear here."
      className="min-h-48"
    />
  ) : (
    'No players match these filters.'
  )

  return (
    <div className="flex flex-col gap-2">
      {searchPending && registrations.length > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Spinner className="size-3" />
          Showing previous results while your search updates…
        </p>
      ) : null}
      <DataTable
        columns={columns}
        data={registrations}
        className={cn('min-w-[480px]', searchPending && 'opacity-60')}
        noResultsLabel={noResultsLabel}
        // The search term drives a server-side query, so the input is
        // controlled from outside the table instead of binding to a
        // TanStack column filter (which would re-filter the server's
        // matches). The status and payment filters do bind to columns: they
        // narrow the rows on screen, which is every loaded page of the
        // roster, or the search's best matches while a term is active.
        toolbar={(table) => {
          const filters: Array<DataTableFilterDef> = [
            {
              id: 'status',
              label: 'Status',
              options: statusFilterOptions,
              column: table.getColumn('status'),
            },
          ]
          if (showPaymentColumn) {
            filters.push({
              id: 'payment',
              label: 'Payment',
              options: paymentFilterOptions,
              column: table.getColumn('payment'),
            })
          }
          return (
            <DataTableToolbar
              search={{
                value: searchTerm,
                onChange: onSearchTermChange,
                placeholder: 'Search players',
              }}
              filters={filters}
              actions={actions}
            />
          )
        }}
      />
    </div>
  )
}

// The wording shown before an organizer confirms a rejection, per what the
// server says the rejection would do (see registrationRejectEffect): decline
// an application, remove a confirmed player and free their seat, or bar a
// cancelled row from re-entering. Every arm ends the same way, so every
// description ends with the same way back.
const rejectDescription: Record<'decline' | 'remove' | 'bar', string> = {
  decline:
    'Their application will be declined, and they will not be able to register again unless you approve them later.',
  remove:
    'They will be removed from the event and their seat freed, and they will not be able to register again unless you approve them later.',
  bar: 'Their cancelled registration still lets them re-register. Rejecting it bars them from re-entering unless you approve them later.',
}

function ManagePlayerMenu({
  row,
  disabled,
}: {
  row: RegistrationRow
  // True while `row` is a stale search result (a previous term's row kept
  // on screen to avoid flicker — see RegistrationsTable) rather than a
  // confirmed match for what's currently typed. A stale row's identity is
  // still a real registration, but it may not be the one the organizer
  // thinks they're looking at, so destructive actions are held off.
  disabled: boolean
}) {
  const dropRegistration = useMutation(
    api.tournaments.registrations.dropRegistration,
  )
  const approveRegistration = useMutation(
    api.tournaments.registrations.approveRegistration,
  )
  const rejectRegistration = useMutation(
    api.tournaments.registrations.rejectRegistration,
  )
  const waitlistRegistration = useMutation(
    api.tournaments.registrations.waitlistRegistration,
  )
  const { busy, run } = useBusyAction()

  const [confirmingDrop, setConfirmingDrop] = useState(false)
  const [confirmingReject, setConfirmingReject] = useState(false)

  // Whether the row can be dropped — and whether that cancels the entry
  // (freeing the seat) or records a competitive drop — is server-computed on
  // the row, so the wording always matches what the server would do.
  const cancelsEntry = row.dropEffect === 'cancel'
  const name = displayPlayerName(row.playerName)

  // What approving this row means, for the toast — read straight off the
  // effect the menu renders from.
  const approvedMessage =
    row.approveEffect === 'waitlisted'
      ? `${name} has been promoted from the waitlist.`
      : row.approveEffect === 'rejected'
        ? `${name}'s rejection has been reversed.`
        : `${name}'s registration has been approved.`

  // Approve and waitlist share their run-then-toast shape; reject differs,
  // routing through a confirm dialog instead.
  const runReview = (
    mutate: () => Promise<unknown>,
    successMessage: string,
    failureMessage: string,
  ) =>
    void run(async () => {
      await mutate()
      toast.success(successMessage)
    }, failureMessage)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Manage ${name}`}
          >
            {busy ? <Spinner /> : <MoreHorizontal />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            {/* Review actions appear only when the server offers them, so
                the everyday confirmed-roster menu stays a drop menu. */}
            {row.approveEffect !== null ? (
              <DropdownMenuItem
                disabled={disabled || busy}
                onSelect={() =>
                  runReview(
                    () =>
                      approveRegistration({
                        registrationId: row.registration._id,
                      }),
                    approvedMessage,
                    'Could not approve registration.',
                  )
                }
              >
                <UserCheck />
                Approve registration
              </DropdownMenuItem>
            ) : null}
            {row.waitlistEffect !== null ? (
              <DropdownMenuItem
                disabled={disabled || busy}
                onSelect={() =>
                  runReview(
                    () =>
                      waitlistRegistration({
                        registrationId: row.registration._id,
                      }),
                    `${name} has been moved to the waitlist.`,
                    'Could not move registration to the waitlist.',
                  )
                }
              >
                <Hourglass />
                Move to waitlist
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              variant="destructive"
              disabled={row.dropEffect === null || disabled || busy}
              onSelect={() => setConfirmingDrop(true)}
            >
              <UserMinus />
              Drop player
            </DropdownMenuItem>
            {row.rejectEffect !== null ? (
              <DropdownMenuItem
                variant="destructive"
                disabled={disabled || busy}
                onSelect={() => setConfirmingReject(true)}
              >
                <UserX />
                Reject registration
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmActionDialog
        open={confirmingDrop}
        onOpenChange={setConfirmingDrop}
        icon={<UserMinus />}
        destructive
        title={`Drop ${name}?`}
        description={
          cancelsEntry
            ? 'Their entry will be cancelled and their seat freed, so it does not count as tournament participation.'
            : row.dropWouldConcede
              ? 'This player will be removed from future pairings, and their unfinished match this round will be conceded to their opponent.'
              : 'This player will be removed from future pairings. An elimination already on record is kept.'
        }
        actionLabel="Drop player"
        failureMessage="Could not drop player."
        onConfirm={async () => {
          await dropRegistration({ registrationId: row.registration._id })
          toast.success(
            cancelsEntry
              ? `${name}'s registration has been cancelled.`
              : `${name} has been dropped.`,
          )
        }}
      />

      {row.rejectEffect !== null ? (
        <ConfirmActionDialog
          open={confirmingReject}
          onOpenChange={setConfirmingReject}
          icon={<UserX />}
          destructive
          title={`Reject ${name}?`}
          description={rejectDescription[row.rejectEffect]}
          actionLabel="Reject registration"
          failureMessage="Could not reject registration."
          onConfirm={async () => {
            await rejectRegistration({ registrationId: row.registration._id })
            toast.success(`${name}'s registration has been rejected.`)
          }}
        />
      ) : null}
    </>
  )
}
