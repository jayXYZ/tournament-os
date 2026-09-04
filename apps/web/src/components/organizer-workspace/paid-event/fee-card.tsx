import { useState } from 'react'
import { useQuery } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import {
  FeePreviewPanel,
  StripeOnboardingNotice,
  useFeePreview,
} from './fee-preview'
import { parseDollarsToCents, toDollarsValue } from './money'
import type { FormEvent } from 'react'
import type { Id } from '@tournament-os/backend/convex/_generated/dataModel'
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

// The strings that differ between an entry fee and a badge fee.
export type PaidEventFeeCopy = {
  title: string
  lockedDescription: string
  description: string
  feeLabel: string
  feeEmptyHint: string
  refundDeadlineDescription: string
  // 'Players' | 'Attendees', for the fee preview.
  payersLabel: string
  // 'entry' | 'badge', for the preview's paid-out line.
  paidOutLabel: string
  // 'an entry fee' | 'a badge fee', for the Stripe onboarding warning.
  feePhrase: string
  invalidFeeMessage: string
  saveLabel: string
  savedMessage: string
  saveFailedMessage: string
}

// Fee + refund-deadline settings for either paid-event kind (tournament
// entry fee or convention badge fee). The rules are identical — presence of
// a fee makes the event paid, introducing a charge requires a payouts-ready
// organization, and the fee freezes once any order exists — so the wrappers
// only supply the mutation and the copy.
export function PaidEventFeeCard({
  paidEvent,
  locked,
  idPrefix,
  copy,
  onSave,
}: {
  paidEvent: {
    entryFeeCents?: number
    refundDeadline?: number
    organizationId: Id<'organizations'>
  }
  locked: boolean
  idPrefix: string
  copy: PaidEventFeeCopy
  onSave: (args: {
    entryFeeCents: number
    refundDeadline: number | null
  }) => Promise<void>
}) {
  const paymentSettings = useQuery(
    api.payments.connect.getOrganizationPaymentSettings,
    { organizationId: paidEvent.organizationId },
  )

  const [fee, setFee] = useState(toDollarsValue(paidEvent.entryFeeCents))
  const [refundDeadline, setRefundDeadline] = useState(
    paidEvent.refundDeadline !== undefined
      ? toDatetimeLocalValue(paidEvent.refundDeadline)
      : '',
  )
  const { busy, run } = useBusyAction()

  const payoutsReady = paymentSettings?.connection?.payoutsReady ?? false
  // A stored fee stays visible/clearable even if the connection later
  // regresses; only introducing a charge requires payouts-ready.
  const feeEditable =
    !locked && (payoutsReady || paidEvent.entryFeeCents !== undefined)
  const disabled = locked || busy

  const draftCents = parseDollarsToCents(fee)
  const preview = useFeePreview(draftCents)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      if (Number.isNaN(draftCents)) {
        throw new Error(copy.invalidFeeMessage)
      }
      const deadline =
        refundDeadline === '' ? null : new Date(refundDeadline).getTime()
      if (deadline !== null && !Number.isFinite(deadline)) {
        throw new Error('Enter a valid refund deadline.')
      }
      await onSave({
        entryFeeCents: draftCents,
        refundDeadline: draftCents === 0 ? null : deadline,
      })
      toast.success(copy.savedMessage)
    }, copy.saveFailedMessage)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>
          {locked ? copy.lockedDescription : copy.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-fee`}>
                  {copy.feeLabel}
                </FieldLabel>
                <Input
                  id={`${idPrefix}-fee`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                  disabled={disabled || !feeEditable}
                />
                <FieldDescription>{copy.feeEmptyHint}</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor={`${idPrefix}-refund-deadline`}>
                  Full-refund deadline
                </FieldLabel>
                <Input
                  id={`${idPrefix}-refund-deadline`}
                  type="datetime-local"
                  value={refundDeadline}
                  onChange={(event) => setRefundDeadline(event.target.value)}
                  disabled={disabled || !feeEditable || draftCents === 0}
                />
                <FieldDescription>
                  {copy.refundDeadlineDescription}
                </FieldDescription>
              </Field>
            </div>

            {paymentSettings !== undefined && !payoutsReady && !locked ? (
              <StripeOnboardingNotice
                hasConnection={Boolean(paymentSettings.connection)}
                chargingPhrase={copy.feePhrase}
              />
            ) : null}

            <FeePreviewPanel
              preview={preview}
              payersLabel={copy.payersLabel}
              paidOutLabel={copy.paidOutLabel}
            />

            <div className="flex justify-end">
              <Button type="submit" disabled={disabled || !feeEditable}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                {copy.saveLabel}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
