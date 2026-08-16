import { Link } from '@tanstack/react-router'
import {
  displayPlayerName,
  formatGameScoreline,
  reportAction,
  useDropSelf,
  useMyMatchHistory,
} from '@tournament-os/core'
import { toast } from 'sonner'
import type { api } from '@tournament-os/backend/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
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

type MyDecklistData = FunctionReturnType<
  typeof api.tournaments.decklists.getMyDecklist
>

export function MoreTab({
  tournamentId,
  publicCode,
  collectsDecklists,
  currentMatch,
  myDecklist,
}: {
  tournamentId: Id<'tournaments'>
  publicCode: string
  collectsDecklists: boolean
  currentMatch: MyCurrentMatch | undefined
  // The controller's getMyDecklist result, subscribed there only while the
  // event collects decklists ('skip' otherwise). This tab holds no
  // getMyDecklist subscription of its own, so mounting it never widens what
  // the page reads from the server.
  myDecklist: MyDecklistData | undefined
}) {
  // No wrapper of its own: the controller lays these cards out in whichever
  // grid is active (the More tab's column on phones, the left desktop column).
  return (
    <>
      <DecklistCard
        publicCode={publicCode}
        collectsDecklists={collectsDecklists}
        data={myDecklist}
      />
      <MatchHistoryCard tournamentId={tournamentId} />
      <DropCard tournamentId={tournamentId} currentMatch={currentMatch} />
    </>
  )
}

function DecklistCard({
  publicCode,
  collectsDecklists,
  data,
}: {
  publicCode: string
  collectsDecklists: boolean
  data: MyDecklistData | undefined
}) {
  if (data === undefined) {
    if (collectsDecklists) {
      // The controller's query is still in flight; hold the card's slot.
      return <Skeleton className="h-24" />
    }
    // The event does not collect decklists, so the controller's query is
    // skipped and `data` stays undefined for good. A list kept from before
    // the organizer turned collection off is still viewable on the decklist
    // page (its getMyDecklist has no decklistRequired gate), so link there
    // statically rather than subscribing on /play just to check for one.
    // The link shows even with no list on file; the decklist page's own
    // empty state covers that.
    return (
      <Card>
        <CardHeader>
          <CardTitle>Decklist</CardTitle>
          <CardDescription>
            This event does not collect decklists. Any list you already
            submitted is still on file.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild type="button" variant="outline">
            <Link
              to="/tournaments/$tournamentId/decklist"
              params={{ tournamentId: publicCode }}
            >
              View your decklist
            </Link>
          </Button>
        </CardContent>
      </Card>
    )
  }
  if (data === null) {
    return null
  }

  const { decklist, submissionOpen } = data
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
                  {formatGameScoreline(
                    entry.myGameWins ?? 0,
                    entry.myGameLosses ?? 0,
                    entry.myGameDraws ?? 0,
                  )}
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

  // The presenter's availability rule for reporting doubles as "this match
  // has no result yet": a drop now would concede it.
  const hasUnreportedMatch = reportAction(currentMatch) !== null

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
              ? 'Your current match has no result yet — dropping now concedes it, and your opponent takes the win. If you actually finished the match, report the real result first. Dropping cannot be undone from here; the organizer can reinstate you.'
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
