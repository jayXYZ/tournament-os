import { Link } from '@tanstack/react-router'
import {
  describeDropConfirmation,
  displayPlayerName,
  formatGameScoreline,
  useDropSelf,
  useMyMatchHistory,
} from '@paper-pairings/core'
import { toast } from 'sonner'
import type { api } from '@paper-pairings/backend/convex/_generated/api'
import type { FunctionReturnType } from 'convex/server'
import type { MyCurrentMatch } from '@paper-pairings/core'

import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'
import { boardCount } from '@/components/player-controller/decklist/decklist-draft'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { ResultBadge } from '@/components/shared/result-badge'
import { Button } from '@/components/ui/button'
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
  // No wrapper of its own: the controller lays these sections out in
  // whichever grid is active (the More tab's column on phones, the left
  // desktop column). Hairlines separate them; the first one has none.
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
      <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
        <div>
          <h2 className="text-sm font-medium">Decklist</h2>
          <p className="text-xs/relaxed text-muted-foreground">
            This event does not collect decklists. Any list you already
            submitted is still on file.
          </p>
        </div>
        <div>
          <Button asChild type="button" variant="outline">
            <Link
              to="/tournaments/$tournamentId/decklist"
              params={{ tournamentId: publicCode }}
            >
              View your decklist
            </Link>
          </Button>
        </div>
      </section>
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
    <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-sm font-medium">Decklist</h2>
        <p className="text-xs/relaxed text-muted-foreground">{description}</p>
      </div>
      {decklist || submissionOpen ? (
        <div>
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
        </div>
      ) : null}
    </section>
  )
}

function MatchHistoryCard({
  tournamentId,
}: {
  tournamentId: Id<'tournaments'>
}) {
  const history = useMyMatchHistory(tournamentId)

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-sm font-medium">Match history</h2>
        <p className="text-xs/relaxed text-muted-foreground">
          Your results in this tournament.
        </p>
      </div>
      <div className="grid gap-1.5">
        {history === undefined ? (
          [0, 1].map((row) => <Skeleton key={row} className="h-10" />)
        ) : history.length === 0 ? (
          <p className="text-xs/relaxed text-muted-foreground">
            No matches yet.
          </p>
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
      </div>
    </section>
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
      <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
        <div>
          <h2 className="text-sm font-medium">Dropped</h2>
          <p className="text-xs/relaxed text-muted-foreground">
            You have dropped from this tournament. You can keep watching
            standings, and your finished matches still count.
          </p>
        </div>
      </section>
    )
  }

  if (currentMatch?.myRegistrationStatus === 'disqualified') {
    return (
      <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
        <div>
          <h2 className="text-sm font-medium">Disqualified</h2>
          <p className="text-xs/relaxed text-muted-foreground">
            You have been disqualified from this tournament. Your finished
            matches stay on record and still count for opponents&apos;
            tiebreakers.
          </p>
        </div>
      </section>
    )
  }

  if (currentMatch?.myRegistrationStatus !== 'active') {
    return null
  }

  return (
    <section className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div>
        <h2 className="text-sm font-medium">Drop from tournament</h2>
        <p className="text-xs/relaxed text-muted-foreground">
          Dropping removes you from future rounds immediately. Your finished
          matches still count for opponents&apos; tiebreakers.
        </p>
      </div>
      <div>
        <ConfirmActionDialog
          trigger={
            <Button type="button" variant="destructive">
              Drop from tournament
            </Button>
          }
          destructive
          title="Drop from this tournament?"
          description={describeDropConfirmation(currentMatch)}
          cancelLabel="Stay in"
          actionLabel="Drop"
          failureMessage="Could not drop from the tournament."
          onConfirm={async () => {
            await dropSelf({ tournamentId })
            toast.success('You have dropped from the tournament.')
          }}
        />
      </div>
    </section>
  )
}
