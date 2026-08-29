import { useMutation } from 'convex/react'
import { Flag, Globe } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { isTournamentEnded } from '@/components/tournaments'
import { ConfirmActionDialog } from '@/components/shared/confirm-action-dialog'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

// Publish → complete: the explicit transitions a convention moves through
// (ADR 0004 — no start phase; each ticket type's sale window governs what
// is purchasable while the convention runs).
export function ConventionLifecycleCard({
  convention,
}: {
  convention: Doc<'conventions'>
}) {
  const publishConvention = useMutation(
    api.conventions.lifecycle.publishConvention,
  )
  const completeConvention = useMutation(
    api.conventions.lifecycle.completeConvention,
  )

  if (isTournamentEnded(convention.lifecycle)) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lifecycle</CardTitle>
        <CardDescription>
          Publishing opens ticket sales; completing ends the convention and
          releases the ticket-fee payout. Each ticket controls when its own
          sales stop.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {convention.lifecycle === 'setup' ? (
          <ConfirmActionDialog
            trigger={
              <Button type="button" variant="outline">
                <Globe data-icon="inline-start" />
                Publish
              </Button>
            }
            icon={<Globe />}
            title={`Publish ${convention.name}?`}
            description="Publishing opens ticket sales. Who can see the convention is controlled by its visibility setting."
            actionLabel="Publish"
            failureMessage="Could not publish convention."
            onConfirm={async () => {
              await publishConvention({ conventionId: convention._id })
              toast.success('Convention published.')
            }}
          />
        ) : null}
        {convention.lifecycle === 'registration' ? (
          <ConfirmActionDialog
            trigger={
              <Button type="button" variant="outline">
                <Flag data-icon="inline-start" />
                Complete convention
              </Button>
            }
            icon={<Flag />}
            title={`Complete ${convention.name}?`}
            description="Marks the convention over and closes ticket sales. If it sold paid tickets, the payout to the organization starts now. Events keep their own lifecycles."
            actionLabel="Complete"
            failureMessage="Could not complete convention."
            onConfirm={async () => {
              await completeConvention({ conventionId: convention._id })
              toast.success('Convention completed.')
            }}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}
