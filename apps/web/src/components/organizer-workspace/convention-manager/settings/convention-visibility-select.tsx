import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import type { TournamentVisibility } from '@/components/tournaments'
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

const visibilityOptions = Object.entries(tournamentVisibilities) as Array<
  [TournamentVisibility, { label: string; description: string }]
>

export function ConventionVisibilitySelect({
  convention,
}: {
  convention: Doc<'conventions'>
}) {
  const updateVisibility = useMutation(
    api.conventions.lifecycle.updateConventionVisibility,
  )
  const { busy, run } = useBusyAction()

  async function handleChange(visibility: TournamentVisibility) {
    if (visibility === convention.visibility) {
      return
    }
    await run(async () => {
      await updateVisibility({ conventionId: convention._id, visibility })
      toast.success(
        `Visibility set to ${tournamentVisibilities[visibility].label.toLowerCase()}.`,
      )
    }, 'Could not update visibility.')
  }

  return (
    <Select
      disabled={busy || convention.lifecycle === 'cancelled'}
      value={convention.visibility}
      onValueChange={(value) =>
        void handleChange(value as TournamentVisibility)
      }
    >
      <SelectTrigger aria-label="Convention visibility">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {visibilityOptions.map(([value, { label, description }]) => (
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
