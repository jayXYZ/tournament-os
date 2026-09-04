import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, usePaginatedQuery, useQuery } from 'convex/react'
import { Link2, Trophy, Unlink } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { useManagedConvention } from './convention-manager-context'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { CreateTournamentDialog } from '@/components/organizer-workspace/create-tournament-dialog'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { LoadMoreButton } from '@/components/shared/load-more-button'
import { TableEmptyState } from '@/components/shared/table-empty-state'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import {
  TournamentLifecycleBadge,
  formatTournamentDateShort,
} from '@/components/tournaments'
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useBusyAction } from '@/hooks/use-busy-action'

const EVENTS_PAGE_SIZE = 50

export function ConventionEventsView() {
  const { conventionId } = useManagedConvention()
  const {
    results: children,
    status,
    loadMore,
  } = usePaginatedQuery(
    api.conventions.events.listChildEvents,
    { conventionId },
    { initialNumItems: EVENTS_PAGE_SIZE },
  )

  return (
    <section className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Convention events</CardTitle>
          <CardDescription>
            The tournaments held at this convention. Each keeps its own
            registration, rounds, and standings.
          </CardDescription>
          <CardAction>
            <div className="flex items-center gap-2">
              <AttachTournamentDialog conventionId={conventionId} />
              <CreateTournamentDialog conventionId={conventionId} />
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          {status === 'LoadingFirstPage' ? (
            <TableLoadingSkeleton rows={3} />
          ) : children.length === 0 ? (
            <TableEmptyState
              icon={Trophy}
              title="No events yet"
              description="Create a tournament under this convention or attach an existing one."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Starts</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Players</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {children.map((tournament) => (
                  <ChildEventRow
                    key={tournament._id}
                    conventionId={conventionId}
                    tournament={tournament}
                  />
                ))}
              </TableBody>
            </Table>
          )}
          <LoadMoreButton
            className="mt-4"
            status={status}
            onLoadMore={() => loadMore(EVENTS_PAGE_SIZE)}
            label="Load more events"
            loadingLabel="Loading more events…"
          />
        </CardContent>
      </Card>
    </section>
  )
}

function ChildEventRow({
  conventionId,
  tournament,
}: {
  conventionId: Id<'conventions'>
  tournament: {
    _id: Id<'tournaments'>
    name: string
    publicCode: number
    startDate: number
    lifecycle:
      | 'setup'
      | 'registration'
      | 'in_progress'
      | 'completed'
      | 'cancelled'
    playerCapacity: number
    registeredCount: number
  }
}) {
  const detachTournament = useMutation(api.conventions.events.detachTournament)
  const { run } = useBusyAction()
  // Started events keep their convention history; only pre-start children
  // can be detached (the backend refuses otherwise).
  const detachable =
    tournament.lifecycle === 'setup' || tournament.lifecycle === 'registration'

  return (
    <TableRow>
      <TableCell>
        <Link
          to="/admin/tournaments/$tournamentId"
          params={{ tournamentId: String(tournament.publicCode) }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {tournament.name}
        </Link>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatTournamentDateShort(tournament.startDate)}
      </TableCell>
      <TableCell>
        <TournamentLifecycleBadge lifecycle={tournament.lifecycle} />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {tournament.registeredCount} / {tournament.playerCapacity}
      </TableCell>
      <TableCell className="text-right">
        {detachable ? (
          <ConfirmActionDialog
            trigger={
              <Button type="button" variant="ghost" size="sm">
                <Unlink data-icon="inline-start" />
                Detach
              </Button>
            }
            icon={<Unlink />}
            title={`Detach ${tournament.name}?`}
            description="The tournament becomes a standalone event again. Nothing about its registrations or schedule changes."
            actionLabel="Detach"
            failureMessage="Could not detach the tournament."
            onConfirm={() =>
              run(async () => {
                await detachTournament({
                  conventionId,
                  tournamentId: tournament._id,
                })
                toast.success('Tournament detached.')
              }, 'Could not detach the tournament.')
            }
          />
        ) : null}
      </TableCell>
    </TableRow>
  )
}

function AttachTournamentDialog({
  conventionId,
}: {
  conventionId: Id<'conventions'>
}) {
  const [open, setOpen] = useState(false)
  const attachable = useQuery(
    api.conventions.events.listAttachableTournaments,
    open ? { conventionId } : 'skip',
  )
  const attachTournament = useMutation(api.conventions.events.attachTournament)
  const { busy, run } = useBusyAction()

  async function handleAttach(tournamentId: Id<'tournaments'>) {
    await run(async () => {
      await attachTournament({ conventionId, tournamentId })
      toast.success('Tournament attached.')
      setOpen(false)
    }, 'Could not attach the tournament.')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Link2 data-icon="inline-start" />
          Attach existing
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Attach a tournament</DialogTitle>
          <DialogDescription>
            Standalone tournaments in this organization that have not started
            yet. Attaching does not change their settings or registrations.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-80 flex-col gap-2 overflow-y-auto">
          {attachable === undefined ? (
            <TableLoadingSkeleton rows={3} />
          ) : attachable.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No unattached upcoming tournaments in this organization.
            </p>
          ) : (
            attachable.map((tournament) => (
              <div
                key={tournament._id}
                className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {tournament.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatTournamentDateShort(tournament.startDate)}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void handleAttach(tournament._id)}
                >
                  Attach
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
