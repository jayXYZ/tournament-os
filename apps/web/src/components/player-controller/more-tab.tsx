import { Link } from '@tanstack/react-router'
import {
  displayPlayerName,
  useDropSelf,
  useMyMatchHistory,
} from '@tournament-os/core'
import { useQuery } from 'convex/react'
import { toast } from 'sonner'
import { api } from '@tournament-os/backend/convex/_generated/api'
import type { MyCurrentMatch } from '@tournament-os/core'

import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
import { boardCount } from '@/components/player-controller/decklist/decklist-draft'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { ResultBadge } from '@/components/shared/result-badge'
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
  publicCode,
  collectsDecklists,
  currentMatch,
}: {
  tournamentId: Id<'tournaments'>
  publicCode: string
  collectsDecklists: boolean
  currentMatch: MyCurrentMatch | undefined
}) {
  return (
    <div className="grid gap-4">
      <DecklistCard
        tournamentId={tournamentId}
        publicCode={publicCode}
        collectsDecklists={collectsDecklists}
      />
      <MatchHistoryCard tournamentId={tournamentId} />
      <DropCard tournamentId={tournamentId} currentMatch={currentMatch} />
    </div>
  )
}

function DecklistCard({
  tournamentId,
  publicCode,
  collectsDecklists,
}: {
  tournamentId: Id<'tournaments'>
  publicCode: string
  collectsDecklists: boolean
}) {
  const data = useQuery(api.tournaments.decklists.getMyDecklist, {
    tournamentId,
  })

  if (data === undefined) {
    // No skeleton when the event doesn't collect decklists — the card is
    // usually about to resolve to nothing (it only survives for a list kept
    // from before the organizer turned collection off).
    return collectsDecklists ? <Skeleton className="h-24" /> : null
  }
  if (data === null) {
    return null
  }

  const { decklist, submissionOpen } = data
  // The settings copy promises "Turning this off keeps any submitted lists",
  // so a stored list stays reachable after collection is turned off; players
  // without one just see no decklist card.
  if (!collectsDecklists && decklist === null) {
    return null
  }
  const description = decklist
    ? [
        decklist.deckName,
        `${boardCount(decklist.maindeck)} main · ${boardCount(decklist.sideboard)} side`,
      ]
        .filter(Boolean)
        .join(' — ')
    : submissionOpen
      ? 'This event requires a decklist. Submit yours before the tournament starts.'
      : 'Submission is closed and no decklist is on file. Talk to the organizer if you still need to register one.'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Decklist</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {decklist || submissionOpen ? (
        <CardContent>
          <Button
            asChild
            type="button"
            variant={decklist ? 'outline' : 'default'}
          >
            <Link
              to="/tournaments/$tournamentId/decklist"
              params={{ tournamentId: publicCode }}
            >
              {submissionOpen
                ? decklist
                  ? 'Edit decklist'
                  : 'Submit decklist'
                : 'View decklist'}
            </Link>
          </Button>
        </CardContent>
      ) : null}
    </Card>
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
                {entry.isBye ? 'Bye' : displayPlayerName(entry.opponentName)}
              </span>
              {entry.result !== 'pending' ? (
                <span className="text-sm tabular-nums text-muted-foreground">
                  {entry.myGameWins ?? 0}–{entry.myGameLosses ?? 0}
                </span>
              ) : null}
              <ResultBadge result={entry.result} />
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
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
