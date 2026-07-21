import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  ClipboardList,
  FlaskConical,
  MoreHorizontal,
  Settings2,
  UserMinus,
} from 'lucide-react'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { displayPlayerName } from '@tournament-os/core'
import { toast } from 'sonner'
import type { ColumnDef } from '@tanstack/react-table'
import type {
  Doc,
  Id,
} from '@tournament-os/backend/convex/_generated/dataModel'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { TableEmptyState } from '@/components/shared/table-empty-state'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { TableSearchInput } from '@/components/shared/table-search-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { DataTable, DataTableColumnHeader } from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

type RegistrationRow = {
  registration: Doc<'tournamentRegistrations'>
  playerName: string | undefined
}

type RegistrationStatus = Doc<'tournamentRegistrations'>['status']

const statusBadgeVariant: Record<
  RegistrationStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  active: 'default',
  pending: 'outline',
  eliminated: 'secondary',
  dropped: 'destructive',
  disqualified: 'destructive',
}

export function RegistrationsView({
  tournamentId,
}: {
  tournamentId: Id<'tournaments'>
}) {
  const registrations = useQuery(
    api.tournaments.registrations.listRegistrations,
    {
      tournamentId,
    },
  )
  const setup = useQuery(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId,
  })

  return (
    <section className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Player registrations</CardTitle>
          <CardDescription>
            Review and manage the players signed up for this tournament.
          </CardDescription>
          <CardAction>
            <RegistrationSettingsMenu
              tournament={setup?.tournament}
              registrations={registrations}
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          <RegistrationsTable registrations={registrations} />
        </CardContent>
      </Card>
    </section>
  )
}

function RegistrationSettingsMenu({
  registrations,
  tournament,
}: {
  registrations: Array<RegistrationRow> | undefined
  tournament: Doc<'tournaments'> | undefined
}) {
  const seedTestPlayers = useMutation(api.tournaments.testing.seedTestPlayers)
  const { busy, run } = useBusyAction()

  const activeRegistrations =
    registrations?.filter((row) => row.registration.status === 'active')
      .length ?? 0
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

const registrationColumns: Array<ColumnDef<RegistrationRow>> = [
  {
    id: 'player',
    accessorFn: (row) => displayPlayerName(row.playerName),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Player" />
    ),
    // Greedy column absorbs width variance so the columns after it stay put as
    // names change length across pages.
    meta: { className: 'w-full' },
    cell: ({ row }) => (
      <p className="font-medium text-foreground">
        {displayPlayerName(row.original.playerName)}
      </p>
    ),
  },
  {
    id: 'status',
    accessorFn: (row) => row.registration.status,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Status" />
    ),
    // Fixed width keeps the badge from shifting as the longest visible status
    // label (e.g. "disqualified" vs "active") changes between pages.
    meta: { className: 'w-32' },
    cell: ({ row }) => {
      const { status } = row.original.registration
      return (
        <Badge variant={statusBadgeVariant[status]} className="capitalize">
          {status}
        </Badge>
      )
    },
  },
  {
    id: 'actions',
    header: 'Manage',
    enableSorting: false,
    meta: { className: 'text-right' },
    cell: ({ row }) => <ManagePlayerMenu row={row.original} />,
  },
]

function RegistrationsTable({
  registrations,
}: {
  registrations: Array<RegistrationRow> | undefined
}) {
  if (registrations === undefined) {
    return <TableLoadingSkeleton />
  }

  if (registrations.length === 0) {
    return (
      <TableEmptyState
        icon={ClipboardList}
        title="No registrations yet"
        description="Players who sign up for this tournament will appear here."
      />
    )
  }

  return (
    <DataTable
      columns={registrationColumns}
      data={registrations}
      className="min-w-[480px]"
      noResultsLabel="No players match your search."
      toolbar={(table) => (
        <TableSearchInput
          table={table}
          columnId="player"
          placeholder="Search players..."
        />
      )}
    />
  )
}

function ManagePlayerMenu({ row }: { row: RegistrationRow }) {
  const dropRegistration = useMutation(
    api.tournaments.registrations.dropRegistration,
  )

  const [confirmingDrop, setConfirmingDrop] = useState(false)

  const alreadyDropped = row.registration.status === 'dropped'
  const name = displayPlayerName(row.playerName)

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
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              disabled={alreadyDropped}
              onSelect={() => setConfirmingDrop(true)}
            >
              <UserMinus />
              Drop player
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <ConfirmActionDialog
        open={confirmingDrop}
        onOpenChange={setConfirmingDrop}
        icon={<UserMinus />}
        destructive
        title={`Drop ${name}?`}
        description="This player will be removed from future pairings and their status will be set to dropped."
        actionLabel="Drop player"
        failureMessage="Could not drop player."
        onConfirm={async () => {
          await dropRegistration({ registrationId: row.registration._id })
          toast.success(`${name} has been dropped.`)
        }}
      />
    </>
  )
}
