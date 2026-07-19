import { useState } from 'react'
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

export function VisibilitySelect({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const updateVisibility = useMutation(
    api.tournaments.lifecycle.updateTournamentVisibility,
  )
  const [busy, setBusy] = useState(false)

  async function handleChange(visibility: Doc<'tournaments'>['visibility']) {
    if (visibility === tournament.visibility) {
      return
    }
    setBusy(true)
    try {
      await updateVisibility({ tournamentId: tournament._id, visibility })
      toast.success(
        `Visibility set to ${tournamentVisibilities[visibility].label.toLowerCase()}.`,
      )
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not update visibility.',
      )
    } finally {
      setBusy(false)
    }
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
