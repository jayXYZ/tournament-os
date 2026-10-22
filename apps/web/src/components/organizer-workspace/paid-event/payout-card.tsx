import { useState } from 'react'
import { toast } from 'sonner'

import { mutationErrorMessage } from '@paper-pairings/core'
import { canManageOrganizationPayments } from '@paper-pairings/shared/organizer-utils'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '@paper-pairings/backend/convex/_generated/api'
import { SectionHeader } from '@/components/shared/section-header'
import { formatCents } from '@/lib/money'
import { useOrganization } from '@/components/organizer-workspace/organization-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

type PayoutSummary = FunctionReturnType<
  typeof api.payments.payouts.getTournamentPayout
>
type RefundsNeedingAttention = FunctionReturnType<
  typeof api.payments.refunds.listRefundsNeedingAttention
>
type RefundNeedingAttention = RefundsNeedingAttention['refunds'][number]
type RefundStatusCheck = FunctionReturnType<
  typeof api.payments.refunds.checkRefundStatus
>

export type PaidEventPayoutCopy = {
  title: string
  description: string
  // Shown until the event completes and the sweep starts.
  pendingMessage: string
  // 'entry fees' | 'badge fees', for the absorbed-fee breakdown line.
  feesLabel: string
}

// What a status check established, in the organizer's terms. A check that
// found nothing leaves the refund (and the payout) exactly as it was; the
// reference is what the platform operator needs to take it further.
function describeRefundCheck(
  check: RefundStatusCheck,
  refundId: RefundNeedingAttention['refundId'],
) {
  const contactOperator = `The payout remains paused. Contact the platform operator with reference ${refundId}.`
  switch (check.result) {
    case 'settled':
      return check.status === 'succeeded'
        ? {
            kind: 'success' as const,
            message: 'Stripe confirmed this refund went through.',
          }
        : {
            kind: 'info' as const,
            message:
              'Stripe reports this refund failed, so no money was returned. The payout no longer waits on it.',
          }
    case 'processing':
      return {
        kind: 'info' as const,
        message:
          'Stripe is still processing this refund. The payout stays paused until it settles.',
      }
    case 'unresolved':
      return {
        kind: 'warning' as const,
        message: `Stripe has no record of this refund. ${contactOperator}`,
      }
    case 'mismatch':
      return {
        kind: 'warning' as const,
        message: `Stripe holds a refund for this entry with a different amount (${formatCents(check.amountCents)}). ${contactOperator}`,
      }
    case 'check_failed':
      return {
        kind: 'error' as const,
        message: `Could not check this refund with Stripe: ${check.message}`,
      }
  }
}

// Payout status for either paid-event kind: fees transfer to the
// organization's Stripe account when the event completes
// (payments/payouts.ts); blocked or failed payouts retry from here. Refunds
// whose outcome could not be confirmed block the payout and are listed
// above it, each with a status check against Stripe's record — the check
// settles what Stripe knows about and never issues a refund itself. The
// wrappers supply the query results and the two verbs.
export function PaidEventPayoutCard({
  isPaid,
  completed,
  payout,
  refundsNeedingAttention,
  onRetry,
  onCheckRefund,
  copy,
}: {
  isPaid: boolean
  completed: boolean
  // undefined while loading (or while the query is skipped pre-completion).
  payout: PayoutSummary | undefined
  refundsNeedingAttention: RefundsNeedingAttention | undefined
  onRetry: () => Promise<unknown>
  onCheckRefund: (
    refundId: RefundNeedingAttention['refundId'],
  ) => Promise<RefundStatusCheck>
  copy: PaidEventPayoutCopy
}) {
  const { selectedOrganization } = useOrganization()
  const [retrying, setRetrying] = useState(false)
  const [checkingRefund, setCheckingRefund] = useState<
    RefundNeedingAttention['refundId'] | null
  >(null)

  if (!isPaid) {
    return null
  }

  const canRetry = selectedOrganization
    ? canManageOrganizationPayments(selectedOrganization.membership.role)
    : false

  async function handleRetry() {
    setRetrying(true)
    try {
      await onRetry()
      toast.success('Payout retry started.')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not retry the payout.'))
    } finally {
      setRetrying(false)
    }
  }

  async function handleCheckRefund(
    refundId: RefundNeedingAttention['refundId'],
  ) {
    setCheckingRefund(refundId)
    try {
      const outcome = describeRefundCheck(
        await onCheckRefund(refundId),
        refundId,
      )
      toast[outcome.kind](outcome.message)
    } catch (error) {
      toast.error(
        mutationErrorMessage(error, 'Could not check the refund status.'),
      )
    } finally {
      setCheckingRefund(null)
    }
  }

  const parkedRefunds = refundsNeedingAttention?.refunds ?? []

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={copy.title} description={copy.description} />
      {parkedRefunds.length > 0 ? (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-2">
            {parkedRefunds.map((refund) => (
              <li
                key={refund.refundId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 p-3"
              >
                <div className="flex flex-col gap-1 text-sm">
                  <span>
                    We couldn't confirm the outcome of the{' '}
                    {formatCents(refund.amountCents)} refund to{' '}
                    {refund.playerName ?? 'a player'}. The payout remains
                    paused.
                  </span>
                  {refund.lastError ? (
                    <span className="text-muted-foreground">
                      {refund.lastError}
                    </span>
                  ) : null}
                  <span className="text-muted-foreground">
                    Check its status, or contact the platform operator with
                    reference {refund.refundId} ({refund.attemptCount} recorded{' '}
                    {refund.attemptCount === 1 ? 'attempt' : 'attempts'}
                    ).
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canRetry || checkingRefund !== null}
                  onClick={() => void handleCheckRefund(refund.refundId)}
                >
                  {checkingRefund === refund.refundId ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  Check refund status
                </Button>
              </li>
            ))}
          </ul>
          {refundsNeedingAttention?.hasMore ? (
            <p className="text-sm text-muted-foreground">
              More refunds need attention than are shown here; they appear as
              these settle. The platform operator can inspect all of them for
              this event.
            </p>
          ) : null}
          {!canRetry && (
            <p className="text-sm text-muted-foreground">
              Only the organization owner can check a refund's status.
            </p>
          )}
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        {!completed ? (
          <p className="text-sm text-muted-foreground">{copy.pendingMessage}</p>
        ) : payout === undefined ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner data-icon="inline-start" />
            Loading payout status
          </p>
        ) : payout === null ? (
          <p className="text-sm text-muted-foreground">
            The payout has not started yet.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={
                  payout.status === 'completed'
                    ? 'default'
                    : payout.status === 'failed' || payout.status === 'blocked'
                      ? 'destructive'
                      : 'secondary'
                }
              >
                {payout.status === 'completed'
                  ? 'Paid out'
                  : payout.status === 'failed'
                    ? 'Failed'
                    : payout.status === 'blocked'
                      ? 'Blocked'
                      : 'In progress'}
              </Badge>
              {payout.status === 'completed' ? (
                <span className="text-sm font-medium">
                  {formatCents(payout.netCents)}
                </span>
              ) : null}
            </div>
            {payout.absorbedFeeCents > 0 ? (
              <p className="text-sm text-muted-foreground">
                {formatCents(payout.totalEntryCents)} in {copy.feesLabel} −{' '}
                {formatCents(payout.absorbedFeeCents)} absorbed refund fees ={' '}
                {formatCents(payout.netCents)}
              </p>
            ) : null}
            {payout.error ? (
              <p className="text-sm text-destructive">{payout.error}</p>
            ) : null}
            {(payout.status === 'blocked' || payout.status === 'failed') && (
              <div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canRetry || retrying}
                  onClick={() => void handleRetry()}
                >
                  {retrying ? <Spinner data-icon="inline-start" /> : null}
                  Retry payout
                </Button>
                {!canRetry && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Only the organization owner can retry the payout.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
