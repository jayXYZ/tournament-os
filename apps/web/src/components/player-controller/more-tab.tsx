import {

  useDropSelf,
  useMyMatchHistory
} from '@tournament-os/core'
import { toast } from 'sonner'
import type {MyCurrentMatch} from '@tournament-os/core';

import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

export function MoreTab({
  tournamentId,
  currentMatch,
}: {
  tournamentId: Id<'tournaments'>
  currentMatch: MyCurrentMatch | undefined
}) {
  return (
    <div className="grid gap-4">
      <MatchHistoryCard tournamentId={tournamentId} />
      <DropCard tournamentId={tournamentId} currentMatch={currentMatch} />
    </div>
  )
}

function MatchHistoryCard({
  tournamentId,
}: {
  tournamentId: Id<'tournaments'>
}) {
  const history = useMyMatchHistory(tournamentId)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Match history</CardTitle>
        <CardDescription>Your results in this tournament.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1.5">
        {history === undefined ? (
          [0, 1].map((row) => <Skeleton key={row} className="h-10" />)
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No matches yet.</p>
        ) : (
          history.map((entry) => (
            <div
              key={entry.roundNumber}
              className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
            >
              <span className="w-9 shrink-0 text-xs font-medium text-muted-foreground">
                R{entry.roundNumber}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {entry.isBye ? 'Bye' : (entry.opponentName ?? 'Unknown player')}
              </span>
              {entry.result === 'pending' ? (
                <Badge variant="outline">Pending</Badge>
              ) : (
                <span className="text-sm tabular-nums text-muted-foreground">
                  {entry.myGameWins ?? 0}–{entry.myGameLosses ?? 0}
                </span>
              )}
              <ResultBadge result={entry.result} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}

function ResultBadge({
  result,
}: {
  result: 'win' | 'loss' | 'draw' | 'pending'
}) {
  if (result === 'pending') {
    return null
  }
  if (result === 'win') {
    return <Badge>Win</Badge>
  }
  if (result === 'loss') {
    return <Badge variant="secondary">Loss</Badge>
  }
  return <Badge variant="outline">Draw</Badge>
}

function DropCard({
  tournamentId,
  currentMatch,
}: {
  tournamentId: Id<'tournaments'>
  currentMatch: MyCurrentMatch | undefined
}) {
  const dropSelf = useDropSelf()

  if (currentMatch?.myRegistrationStatus === 'dropped') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dropped</CardTitle>
          <CardDescription>
            You have dropped from this tournament. You can keep watching
            standings, and your finished matches still count.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (currentMatch?.myRegistrationStatus !== 'active') {
    return null
  }

  const hasUnreportedMatch =
    currentMatch.kind === 'match' &&
    currentMatch.match.matchStatus === 'upcoming' &&
    !currentMatch.me.isBye

  return (
    <Card>
      <CardHeader>
        <CardTitle>Drop from tournament</CardTitle>
        <CardDescription>
          Dropping removes you from future rounds immediately. Your finished
          matches still count for opponents&apos; tiebreakers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ConfirmActionDialog
          trigger={
            <Button type="button" variant="destructive">
              Drop from tournament
            </Button>
          }
          destructive
          title="Drop from this tournament?"
          description={
            hasUnreportedMatch
              ? 'Your current match has no result yet — report it (or tell the organizer) before you leave. Dropping cannot be undone from here; the organizer can reinstate you.'
              : 'You will not be paired in any future rounds. Dropping cannot be undone from here; the organizer can reinstate you.'
          }
          cancelLabel="Stay in"
          actionLabel="Drop"
          failureMessage="Could not drop from the tournament."
          onConfirm={async () => {
            await dropSelf({ tournamentId })
            toast.success('You have dropped from the tournament.')
          }}
        />
      </CardContent>
    </Card>
  )
}
