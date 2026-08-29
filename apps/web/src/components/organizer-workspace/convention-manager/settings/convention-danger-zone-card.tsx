import { useNavigate } from '@tanstack/react-router'
import { useMutation } from 'convex/react'
import { Ban, Trash2 } from 'lucide-react'
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
import { Separator } from '@/components/ui/separator'

export function ConventionDangerZoneCard({
  convention,
}: {
  convention: Doc<'conventions'>
}) {
  const cancelConvention = useMutation(
    api.conventions.lifecycle.cancelConvention,
  )
  const deleteConvention = useMutation(
    api.conventions.lifecycle.deleteConvention,
  )
  const navigate = useNavigate()
  const cancellable = !isTournamentEnded(convention.lifecycle)

  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle className="text-destructive">Danger zone</CardTitle>
        <CardDescription>
          These actions affect attendees and cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {cancellable ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="grid gap-1 text-sm">
                <p className="font-medium">Cancel this convention</p>
                <p className="text-muted-foreground">
                  Badge payments are refunded. Events at the convention are not
                  cancelled — they stay attached and keep running unless you
                  cancel them individually.
                </p>
              </div>
              <ConfirmActionDialog
                trigger={
                  <Button type="button" variant="outline">
                    <Ban data-icon="inline-start" />
                    Cancel convention
                  </Button>
                }
                icon={<Ban />}
                destructive
                title={`Cancel ${convention.name}?`}
                description="Badge registration ends and every badge payment is refunded. Events held at the convention are untouched — cancel any that should not run from their own settings. This cannot be undone."
                cancelLabel="Keep convention"
                actionLabel="Cancel convention"
                failureMessage="Could not cancel convention."
                onConfirm={async () => {
                  await cancelConvention({ conventionId: convention._id })
                  toast.success('Convention cancelled.')
                }}
              />
            </div>
            <Separator />
          </>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1 text-sm">
            <p className="font-medium">Delete this convention</p>
            <p className="text-muted-foreground">
              Permanently removes the convention, its badges, and its history.
              Events are detached, never deleted.
            </p>
          </div>
          <ConfirmActionDialog
            trigger={
              <Button type="button" variant="destructive">
                <Trash2 data-icon="inline-start" />
                Delete convention
              </Button>
            }
            icon={<Trash2 />}
            destructive
            title={`Delete ${convention.name}?`}
            description="This permanently deletes the convention along with every badge registration and its audit history. Events held at the convention are detached and preserved as standalone events. This cannot be undone."
            confirmationText={convention.name}
            cancelLabel="Keep convention"
            actionLabel="Delete forever"
            failureMessage="Could not delete convention."
            onConfirm={async () => {
              await deleteConvention({ conventionId: convention._id })
              toast.success('Convention deleted.')
              try {
                await navigate({ to: '/admin/conventions' })
              } catch {
                toast.error(
                  'Convention deleted, but the convention list could not be opened.',
                )
              }
            }}
          />
        </div>
      </CardContent>
    </Card>
  )
}
