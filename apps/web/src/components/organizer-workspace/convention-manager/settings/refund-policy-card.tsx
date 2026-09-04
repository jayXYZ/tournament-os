import { useState } from 'react'
import { useMutation } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import { isConventionLocked } from './is-convention-locked'
import type { FormEvent } from 'react'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { toDatetimeLocalValue } from '@/components/tournaments'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { useBusyAction } from '@/hooks/use-busy-action'

// The one convention-level payment policy left after pricing moved to
// ticket types (ADR 0004): the cancellation refund cutoff. Absent, refunds
// run until the convention starts.
export function RefundPolicyCard({
  convention,
}: {
  convention: Doc<'conventions'>
}) {
  const updateSetup = useMutation(
    api.conventions.lifecycle.updateConventionSetup,
  )
  const locked = isConventionLocked(convention)
  const [refundDeadline, setRefundDeadline] = useState(
    convention.refundDeadline !== undefined
      ? toDatetimeLocalValue(convention.refundDeadline)
      : '',
  )
  const { busy, run } = useBusyAction()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      const deadline =
        refundDeadline === '' ? null : new Date(refundDeadline).getTime()
      if (deadline !== null && !Number.isFinite(deadline)) {
        throw new Error('Enter a valid refund deadline.')
      }
      await updateSetup({
        conventionId: convention._id,
        refundDeadline: deadline,
      })
      toast.success('Refund policy saved.')
    }, 'Could not save the refund policy.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Refund policy</CardTitle>
        <CardDescription>
          {locked
            ? 'Refund settings are locked once the convention is over.'
            : 'Attendees who cancel a paid ticket before this time are refunded in full. Leave empty to allow refunds until the convention starts — never after.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <Field className="max-w-sm">
              <FieldLabel htmlFor="convention-refund-deadline">
                Full-refund deadline
              </FieldLabel>
              <Input
                id="convention-refund-deadline"
                type="datetime-local"
                value={refundDeadline}
                onChange={(event) => setRefundDeadline(event.target.value)}
                disabled={locked || busy}
              />
              <FieldDescription>
                Must be at or before the convention’s start date.
              </FieldDescription>
            </Field>
            <div className="flex justify-end">
              <Button type="submit" disabled={locked || busy}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                Save refund policy
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
