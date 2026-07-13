import { useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  ClipboardPen,
  FlaskConical,
  MoreHorizontal,
  RotateCcw,
  Settings2,
  Swords,
} from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { PlayerMeetingCard } from './player-meeting-card'
import type { FormEvent } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import type { FunctionReturnType } from 'convex/server'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import type { RoundSelection } from '@/components/tournaments'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { WorkspacePageHeader } from '@/components/shared/workspace-page-header'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  TournamentPhaseTabs,
  TournamentRoundTabs,
  useTournamentRoundNavigation,
} from '@/components/tournaments'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DataTable, DataTableColumnHeader } from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Spinner } from '@/components/ui/spinner'

type PairingsBoard = FunctionReturnType<
  typeof api.tournaments.rounds.getPairingsBoard
>
type PairingRow = FunctionReturnType<
  typeof api.tournaments.rounds.listRoundPairings
>[number]
type PairedPlayer = PairingRow['players'][number]

export function PairingsView({
  tournamentId,
  roundSelection,
  onRoundSelectionChange,
}: {
  tournamentId: string
  roundSelection: RoundSelection
  onRoundSelectionChange: (selection: RoundSelection) => void
}) {
  const board = useQuery(api.tournaments.rounds.getPairingsBoard, {
    tournamentId: tournamentId as Id<'tournaments'>,
  })

  const phases = board?.phases ?? []
  const navigation = useTournamentRoundNavigation(
    phases,
    'all',
    roundSelection,
    onRoundSelectionChange,
  )

  const activePhase = navigation.activePhase?.phase

  return (
    <section className="flex flex-col gap-4">
      <WorkspacePageHeader eyebrow="Tournament manager" title="Pairings" />

      {activePhase?.playerMeetingStatus !== undefined ? (
        <PlayerMeetingCard
          phaseId={activePhase._id}
          meetingStatus={activePhase.playerMeetingStatus}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Round pairings</CardTitle>
          <CardDescription>
            View table assignments and match results for each round.
          </CardDescription>
          <CardAction>
            <PairingsSettingsMenu
              board={board}
              roundId={navigation.selectedRound?._id ?? null}
              onRewound={() => onRoundSelectionChange({})}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {board === undefined ? (
            <TableLoadingSkeleton />
          ) : (
            <>
              {navigation.activePhase ? (
                <TournamentPhaseTabs
                  activePhaseId={navigation.activePhase.phase._id}
                  phases={navigation.phases}
                  onValueChange={navigation.selectPhase}
                />
              ) : null}

              {navigation.availableRounds.length === 0 ||
              !navigation.selectedRound ? (
                <Empty className="min-h-64">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Swords />
                    </EmptyMedia>
                    <EmptyTitle>No pairings yet</EmptyTitle>
                    <EmptyDescription>
                      Generate pairings to create the first round and assign
                      players to tables.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <>
                  <TournamentRoundTabs
                    activeRoundNumber={navigation.selectedRound.roundNumber}
                    availableRoundNumbers={navigation.availableRounds.map(
                      (round) => round.roundNumber,
                    )}
                    firstRoundNumber={navigation.firstRoundNumber}
                    onValueChange={navigation.selectRound}
                    roundCount={navigation.roundTabCount}
                  />
                  <PairingsTable roundId={navigation.selectedRound._id} />
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}

function PairingsSettingsMenu({
  board,
  roundId,
  onRewound,
}: {
  board: PairingsBoard | undefined
  roundId: Id<'tournamentRounds'> | null
  onRewound: () => void
}) {
  const generateTestRoundResults = useMutation(
    api.tournaments.testing.generateTestRoundResults,
  )
  const [busy, setBusy] = useState(false)
  const [confirmingRewind, setConfirmingRewind] = useState(false)
  const rewindLatestRound = useMutation(
    api.tournaments.rounds.rewindLatestRound,
  )

  const canSimulate =
    board !== undefined && board.tournament.isTestEvent && roundId !== null

  async function handleSimulateResults() {
    if (!board || !roundId) {
      return
    }

    setBusy(true)
    try {
      await generateTestRoundResults({
        tournamentId: board.tournament._id,
        roundId,
      })
      toast.success('Match results simulated.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not simulate match results.',
      )
    } finally {
      setBusy(false)
    }
  }

  async function handleRewind() {
    if (!board?.rewind.eligible) {
      return
    }
    setBusy(true)
    try {
      await rewindLatestRound({ tournamentId: board.tournament._id })
      setConfirmingRewind(false)
      onRewound()
      toast.success(
        board.rewind.reopenedRoundNumber === null
          ? 'Pairings unpublished. Registration is open again.'
          : `Pairings unpublished. Round ${board.rewind.reopenedRoundNumber} reopened.`,
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not unpublish pairings.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Pairings settings"
          >
            {busy ? <Spinner /> : <Settings2 />}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={!canSimulate || busy}
              onSelect={() => void handleSimulateResults()}
            >
              <FlaskConical />
              Simulate Match Results
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!board?.rewind.eligible || busy}
              title={board?.rewind.reason ?? undefined}
              variant="destructive"
              onSelect={() => setConfirmingRewind(true)}
            >
              <RotateCcw />
              Unpublish pairings and rewind
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirmingRewind}
        onOpenChange={(open) => {
          if (!busy) {
            setConfirmingRewind(open)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="text-destructive">
              <RotateCcw />
            </AlertDialogMedia>
            <AlertDialogTitle>
              Unpublish round {board?.rewind.removedRoundNumber} pairings?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {board?.rewind.reopenedRoundNumber === null
                ? 'These pairings will be permanently removed and registration will reopen.'
                : `These pairings will be permanently removed so you can correct round ${board?.rewind.reopenedRoundNumber} and recalculate its standings.`}{' '}
              The round timer will stop. Tell players that updated pairings are
              coming before generating them again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep pairings</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault()
                void handleRewind()
              }}
            >
              {busy ? <Spinner data-icon="inline-start" /> : <RotateCcw />}
              Unpublish and rewind
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function pairedPlayerName(player: PairedPlayer | undefined) {
  return player?.playerName ?? 'Unknown player'
}

const pairingColumns: Array<ColumnDef<PairingRow>> = [
  {
    id: 'table',
    accessorFn: (row) => row.match.tableNumber ?? Number.POSITIVE_INFINITY,
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Table" />
    ),
    meta: { className: 'w-20' },
    cell: ({ row }) => (
      <span className="font-medium tabular-nums">
        {row.original.match.tableNumber ?? (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </span>
    ),
  },
  {
    id: 'players',
    accessorFn: (row) =>
      row.players.map((player) => pairedPlayerName(player)).join(' '),
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Players" />
    ),
    // Greedy column absorbs name-length variance so the columns after it stay
    // put as pairings change across pages.
    meta: { className: 'w-full' },
    enableSorting: false,
    cell: ({ row }) => <PairingPlayersCell row={row.original} />,
  },
  {
    id: 'result',
    header: 'Result',
    enableSorting: false,
    cell: ({ row }) => <MatchResultCell row={row.original} />,
  },
  {
    id: 'actions',
    header: 'Manage',
    enableSorting: false,
    meta: { className: 'text-right' },
    cell: ({ row }) => <ManageMatchMenu row={row.original} />,
  },
]

function PairingsTable({ roundId }: { roundId: Id<'tournamentRounds'> }) {
  const pairings = useQuery(api.tournaments.rounds.listRoundPairings, {
    roundId,
  })

  if (pairings === undefined) {
    return <TableLoadingSkeleton />
  }

  if (pairings.length === 0) {
    return (
      <Empty className="min-h-64">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Swords />
          </EmptyMedia>
          <EmptyTitle>No matches in this round</EmptyTitle>
          <EmptyDescription>
            Pairings for this round will appear here once they are generated.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <DataTable
      columns={pairingColumns}
      data={pairings}
      className="min-w-[640px]"
      noResultsLabel="No matches match your search."
      toolbar={(table) => (
        <Input
          placeholder="Search players..."
          value={String(table.getColumn('players')?.getFilterValue() ?? '')}
          onChange={(event) =>
            table.getColumn('players')?.setFilterValue(event.target.value)
          }
          className="max-w-xs"
        />
      )}
    />
  )
}

function PairingPlayersCell({ row }: { row: PairingRow }) {
  const playerOne = row.players.at(0)
  const playerTwo = row.players.at(1)
  const isBye = row.players.some((player) => player.isBye)

  return (
    <>
      <p className="font-medium text-foreground">
        {pairedPlayerName(playerOne)}
        {isBye ? null : (
          <span className="font-normal text-muted-foreground"> vs.</span>
        )}
      </p>
      {isBye ? (
        <Badge variant="secondary" className="mt-1">
          Bye
        </Badge>
      ) : (
        <p className="font-medium text-foreground">
          {pairedPlayerName(playerTwo)}
        </p>
      )}
    </>
  )
}

function MatchResultCell({ row }: { row: PairingRow }) {
  const playerOne = row.players.at(0)
  const playerTwo = row.players.at(1)
  const hasResult =
    row.match.matchStatus === 'completed' ||
    row.match.matchStatus === 'confirmed'

  if (!hasResult) {
    return <Badge variant="outline">Awaiting result</Badge>
  }

  const playerOneWins = playerOne?.gameWins ?? 0
  const playerTwoWins = playerOne?.isBye
    ? (playerOne.gameLosses ?? 0)
    : (playerTwo?.gameWins ?? 0)

  if (playerOneWins === playerTwoWins) {
    return (
      <ResultWithProvenance row={row}>
        Draw {playerOneWins}&ndash;{playerTwoWins}
      </ResultWithProvenance>
    )
  }

  const playerOneWon = playerOneWins > playerTwoWins
  const winnerName = pairedPlayerName(playerOneWon ? playerOne : playerTwo)
  const winnerWins = playerOneWon ? playerOneWins : playerTwoWins
  const loserWins = playerOneWon ? playerTwoWins : playerOneWins

  return (
    <ResultWithProvenance row={row}>
      {winnerName} wins {winnerWins}&ndash;{loserWins}
    </ResultWithProvenance>
  )
}

// Distinguishes player self-reported results from organizer-entered ones, so
// the organizer can spot unconfirmed reports before completing the round.
function ResultWithProvenance({
  row,
  children,
}: {
  row: PairingRow
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{children}</span>
      {row.match.matchStatus === 'confirmed' ? (
        <Badge variant="secondary">Confirmed by players</Badge>
      ) : row.match.reportedByRegistrationId !== undefined ? (
        <Badge variant="outline">Player-reported &middot; unconfirmed</Badge>
      ) : null}
    </div>
  )
}

function ManageMatchMenu({ row }: { row: PairingRow }) {
  const isBye = row.players.some((player) => player.isBye)
  const [enteringResult, setEnteringResult] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={
              row.match.tableNumber === undefined
                ? 'Manage bye match'
                : `Manage table ${row.match.tableNumber}`
            }
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={isBye}
              onSelect={() => setEnteringResult(true)}
            >
              <ClipboardPen />
              Enter result
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {enteringResult ? (
        <EnterResultDialog
          row={row}
          open={enteringResult}
          onOpenChange={setEnteringResult}
        />
      ) : null}
    </>
  )
}

function EnterResultDialog({
  row,
  open,
  onOpenChange,
}: {
  row: PairingRow
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const recordMatchResult = useMutation(
    api.tournaments.rounds.recordMatchResult,
  )
  const playerOne = row.players.at(0)
  const playerTwo = row.players.at(1)

  const [busy, setBusy] = useState(false)
  const [playerOneWins, setPlayerOneWins] = useState(
    String(playerOne?.gameWins ?? 0),
  )
  const [playerTwoWins, setPlayerTwoWins] = useState(
    String(playerTwo?.gameWins ?? 0),
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!playerOne || !playerTwo) {
      return
    }

    setBusy(true)
    try {
      await recordMatchResult({
        matchId: row.match._id,
        playerOneRegistrationId: playerOne.playerId,
        playerTwoRegistrationId: playerTwo.playerId,
        playerOneGameWins: Number.parseInt(playerOneWins, 10),
        playerTwoGameWins: Number.parseInt(playerTwoWins, 10),
      })
      onOpenChange(false)
      toast.success('Match result recorded.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not record the match result.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) {
          onOpenChange(nextOpen)
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Enter match result</DialogTitle>
            <DialogDescription>
              Record the game wins for each player
              {row.match.tableNumber === undefined
                ? ''
                : ` at table ${row.match.tableNumber}`}
              .
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`player-one-wins-${row.match._id}`}>
                  {pairedPlayerName(playerOne)}
                </FieldLabel>
                <Input
                  id={`player-one-wins-${row.match._id}`}
                  value={playerOneWins}
                  onChange={(event) => setPlayerOneWins(event.target.value)}
                  type="number"
                  min={0}
                  max={2}
                  disabled={busy}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`player-two-wins-${row.match._id}`}>
                  {pairedPlayerName(playerTwo)}
                </FieldLabel>
                <Input
                  id={`player-two-wins-${row.match._id}`}
                  value={playerTwoWins}
                  onChange={(event) => setPlayerTwoWins(event.target.value)}
                  type="number"
                  min={0}
                  max={2}
                  disabled={busy}
                  required
                />
              </Field>
            </div>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Save result
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
