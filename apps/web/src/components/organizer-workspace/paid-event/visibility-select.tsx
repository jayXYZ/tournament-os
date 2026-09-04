import { toast } from 'sonner'

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

// The visibility dropdown shared by both paid-event kinds (tournaments and
// conventions use the same visibility vocabulary); the thin wrappers supply
// the mutation. A cancelled event locks the control.
export function EventVisibilitySelect({
  event,
  ariaLabel,
  onChange,
}: {
  event: {
    visibility: TournamentVisibility
    lifecycle: Doc<'tournaments'>['lifecycle'] | Doc<'conventions'>['lifecycle']
  }
  ariaLabel: string
  onChange: (visibility: TournamentVisibility) => Promise<void>
}) {
  const { busy, run } = useBusyAction()

  async function handleChange(visibility: TournamentVisibility) {
    if (visibility === event.visibility) {
      return
    }
    await run(async () => {
      await onChange(visibility)
      toast.success(
        `Visibility set to ${tournamentVisibilities[visibility].label.toLowerCase()}.`,
      )
    }, 'Could not update visibility.')
  }

  return (
    <Select
      disabled={busy || event.lifecycle === 'cancelled'}
      value={event.visibility}
      onValueChange={(value) =>
        void handleChange(value as TournamentVisibility)
      }
    >
      <SelectTrigger aria-label={ariaLabel}>
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
