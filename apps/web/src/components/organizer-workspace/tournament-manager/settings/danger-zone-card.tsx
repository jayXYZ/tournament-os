import { CancelTournamentButton } from './cancel-tournament-button'
import { DeleteTournamentButton } from './delete-tournament-button'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import { SectionHeader } from '@/components/shared/section-header'
import { isTournamentEnded } from '@/components/tournaments'
import { Separator } from '@/components/ui/separator'

export function DangerZoneCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const cancellable = !isTournamentEnded(tournament.lifecycle)

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader
        title={<span className="text-destructive">Danger zone</span>}
        description="These actions affect players and cannot be undone."
      />
      <div className="grid gap-4">
        {cancellable ? (
          <>
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
            <Separator />
          </>
        ) : null}
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
      </div>
    </section>
  )
}
