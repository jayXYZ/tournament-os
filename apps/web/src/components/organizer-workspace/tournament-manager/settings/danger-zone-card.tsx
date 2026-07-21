import { CancelTournamentButton } from './cancel-tournament-button'
import { DeleteTournamentButton } from './delete-tournament-button'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

export function DangerZoneCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const cancellable =
    tournament.lifecycle !== 'completed' && tournament.lifecycle !== 'cancelled'

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          These actions affect players and cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
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
      </CardContent>
    </Card>
  )
}
