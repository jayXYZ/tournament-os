import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { tournamentVisibilities } from '@/components/tournaments'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useBusyAction } from '@/hooks/use-busy-action'

export function VisibilitySelect({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const updateVisibility = useMutation(
    api.tournaments.lifecycle.updateTournamentVisibility,
  )
  const { busy, run } = useBusyAction()

  async function handleChange(visibility: Doc<'tournaments'>['visibility']) {
    if (visibility === tournament.visibility) {
      return
    }
    await run(async () => {
      await updateVisibility({ tournamentId: tournament._id, visibility })
      toast.success(
        `Visibility set to ${tournamentVisibilities[visibility].label.toLowerCase()}.`,
      )
    }, 'Could not update visibility.')
  }

  return (
    <Select
      disabled={busy || tournament.lifecycle === 'cancelled'}
      value={tournament.visibility}
      onValueChange={(value) =>
        void handleChange(value as Doc<'tournaments'>['visibility'])
      }
    >
      <SelectTrigger aria-label="Tournament visibility">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {(
            Object.entries(tournamentVisibilities) as Array<
              [
                Doc<'tournaments'>['visibility'],
                (typeof tournamentVisibilities)[keyof typeof tournamentVisibilities],
              ]
            >
          ).map(([value, { label, description }]) => (
            <SelectItem key={value} value={value}>
              {label}
              <span className="text-muted-foreground"> — {description}</span>
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
