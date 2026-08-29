import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { isConventionLocked } from './is-convention-locked'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from '@/components/ui/field'
import { Switch } from '@/components/ui/switch'
import { useBusyAction } from '@/hooks/use-busy-action'

export function BadgeGatingCard({
  convention,
}: {
  convention: Doc<'conventions'>
}) {
  const updateSetup = useMutation(
    api.conventions.lifecycle.updateConventionSetup,
  )
  const { busy, run } = useBusyAction()
  const locked = isConventionLocked(convention)

  async function handleToggle(checked: boolean) {
    await run(async () => {
      await updateSetup({
        conventionId: convention._id,
        badgeRequiredForChildEvents: checked,
      })
      toast.success(
        checked
          ? 'Convention badge is now required for event registration.'
          : 'Events are open to everyone.',
      )
    }, 'Could not update badge requirement.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Badge requirement</CardTitle>
        <CardDescription>
          Whether registering for events at this convention requires a confirmed
          convention badge first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field orientation="horizontal" data-disabled={locked || busy}>
          <Switch
            id="convention-badge-required"
            checked={convention.badgeRequiredForChildEvents}
            onCheckedChange={(checked) => void handleToggle(checked === true)}
            disabled={locked || busy}
          />
          <FieldContent>
            <FieldLabel htmlFor="convention-badge-required">
              Require a badge to register for events
            </FieldLabel>
            <FieldDescription>
              Applies when players register themselves. It never revokes event
              registrations already made, and organizer actions (approvals,
              guest enrollment) bypass it.
            </FieldDescription>
          </FieldContent>
        </Field>
      </CardContent>
    </Card>
  )
}
