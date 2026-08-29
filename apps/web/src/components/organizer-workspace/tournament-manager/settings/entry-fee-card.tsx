import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useMutation, useQuery } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@tournament-os/backend/convex/_generated/api'
import {
  MIN_ENTRY_FEE_CENTS,
  validateEntryFeeCents,
} from '@tournament-os/shared/payment-fees'
import { isPreStartLocked } from './is-pre-start-locked'
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

function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

// Dollars string for the input from stored cents, and back. An empty input
// means "free event" and clears the fee server-side (entryFeeCents: 0).
function toDollarsValue(cents: number | undefined) {
  return cents === undefined ? '' : (cents / 100).toFixed(2)
}

function parseDollarsToCents(value: string) {
  if (value.trim() === '') {
    return 0
  }
  const dollars = Number.parseFloat(value)
  if (!Number.isFinite(dollars)) {
    return Number.NaN
  }
  return Math.round(dollars * 100)
}

export function EntryFeeCard({
  tournament,
}: {
  tournament: Doc<'tournaments'>
}) {
  const updateTournamentSetup = useMutation(
    api.tournaments.lifecycle.updateTournamentSetup,
  )
  const paymentSettings = useQuery(
    api.payments.connect.getOrganizationPaymentSettings,
    { organizationId: tournament.organizationId },
  )

  const [entryFee, setEntryFee] = useState(
    toDollarsValue(tournament.entryFeeCents),
  )
  const [refundDeadline, setRefundDeadline] = useState(
    tournament.refundDeadline !== undefined
      ? toDatetimeLocalValue(tournament.refundDeadline)
      : '',
  )
  const { busy, run } = useBusyAction()

  const locked = isPreStartLocked(tournament)
  const payoutsReady = paymentSettings?.connection?.payoutsReady ?? false
  // A stored fee stays visible/clearable even if the connection later
  // regresses; only introducing a charge requires payouts-ready.
  const feeEditable =
    !locked && (payoutsReady || tournament.entryFeeCents !== undefined)
  const disabled = locked || busy

  const draftCents = parseDollarsToCents(entryFee)
  const previewArgs =
    Number.isInteger(draftCents) &&
    draftCents >= MIN_ENTRY_FEE_CENTS &&
    validateEntryFeeCents(draftCents) === null
      ? { entryFeeCents: draftCents }
      : ('skip' as const)
  const preview = useQuery(api.payments.queries.getFeePreview, previewArgs)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await run(async () => {
      if (Number.isNaN(draftCents)) {
        throw new Error('Enter a valid entry fee.')
      }
      const deadline =
        refundDeadline === '' ? null : new Date(refundDeadline).getTime()
      if (deadline !== null && !Number.isFinite(deadline)) {
        throw new Error('Enter a valid refund deadline.')
      }
      await updateTournamentSetup({
        tournamentId: tournament._id,
        entryFeeCents: draftCents,
        refundDeadline: draftCents === 0 ? null : deadline,
      })
      toast.success('Entry fee settings saved.')
    }, 'Could not save entry fee settings.')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entry fee</CardTitle>
        <CardDescription>
          {locked
            ? 'Entry fee settings are locked after tournament play begins.'
            : 'Charge players to register. You are paid out exactly the entry cost per paid player; players additionally cover the platform and payment processing fees.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="settings-entry-fee">
                  Entry cost (USD)
                </FieldLabel>
                <Input
                  id="settings-entry-fee"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={entryFee}
                  onChange={(event) => setEntryFee(event.target.value)}
                  disabled={disabled || !feeEditable}
                />
                <FieldDescription>
                  Leave empty for a free event.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="settings-refund-deadline">
                  Full-refund deadline
                </FieldLabel>
                <Input
                  id="settings-refund-deadline"
                  type="datetime-local"
                  value={refundDeadline}
                  onChange={(event) => setRefundDeadline(event.target.value)}
                  disabled={disabled || !feeEditable || draftCents === 0}
                />
                <FieldDescription>
                  Players who unregister before this time are refunded in full.
                  Leave empty to allow refunds until the tournament starts.
                </FieldDescription>
              </Field>
            </div>

            {paymentSettings !== undefined && !payoutsReady && !locked ? (
              <p className="text-sm text-muted-foreground">
                {paymentSettings.connection
                  ? 'Finish the organization’s Stripe onboarding before charging an entry fee.'
                  : 'Connect the organization’s Stripe account before charging an entry fee.'}{' '}
                <Link to="/admin/organization" className="underline">
                  Manage payments
                </Link>
              </p>
            ) : null}

            {preview ? (
              <div className="rounded-md border bg-muted/50 px-4 py-3 text-sm">
                <p className="font-medium">
                  Players pay {formatCents(preview.totalCents)}
                </p>
                <p className="text-muted-foreground">
                  {formatCents(preview.entryFeeCents)} entry (paid out to you) +{' '}
                  {formatCents(preview.platformFeeCents)} platform fee +{' '}
                  {formatCents(preview.processingFeeCents)} estimated payment
                  processing
                </p>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button type="submit" disabled={disabled || !feeEditable}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                Save entry fee
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
