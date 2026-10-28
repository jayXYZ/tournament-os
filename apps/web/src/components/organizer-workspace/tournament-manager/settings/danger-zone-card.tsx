import { CancelTournamentButton } from './cancel-tournament-button'
import { DeleteTournamentButton } from './delete-tournament-button'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import { SectionHeader } from '@/components/shared/section-header'
import { isTournamentEnded } from '@/components/tournaments'
import { Separator } from '@/components/ui/separator'

// Mirrors the backend gate (model/tournaments requireTournamentDeletable):
// only a test event or an unpublished event may be deleted. Players cannot
// enrol before publication, so an unpublished event has nobody's history to
// lose; the backend still checks the roster itself.
function isTournamentDeletable(tournament: Doc<'tournaments'>) {
  return tournament.isTestEvent || tournament.lifecycle === 'setup'
}

export function DangerZoneCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const ended = isTournamentEnded(tournament.lifecycle)
  const cancellable = !ended
  const deletable = isTournamentDeletable(tournament)

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title={<span className="text-destructive">Danger zone</span>}
        description="These actions affect players and cannot be undone."
      />
      <div className="grid gap-4">
        {cancellable ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1 text-sm">
              <p className="font-medium">Cancel this event</p>
              <p className="text-muted-foreground">
                Ends the event immediately. Players keep their results, but no
                further rounds can be played.
              </p>
            </div>
            <CancelTournamentButton tournament={tournament} />
          </div>
        ) : null}
        {cancellable && deletable ? <Separator /> : null}
        {deletable ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="grid gap-1 text-sm">
              <p className="font-medium">Delete this event</p>
              <p className="text-muted-foreground">
                Permanently removes the event with all registrations, pairings,
                and standings.
              </p>
            </div>
            <DeleteTournamentButton tournament={tournament} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {ended
              ? 'This event has ended. Its history is kept for its players, so it cannot be deleted.'
              : 'Published events cannot be deleted, so their history stays with their players. Cancel the event instead.'}
          </p>
        )}
      </div>
    </section>
  )
}
