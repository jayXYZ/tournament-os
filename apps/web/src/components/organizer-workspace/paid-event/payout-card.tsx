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

export type PaidEventPayoutCopy = {
  title: string
  description: string
  // Shown until the event completes and the sweep starts.
  pendingMessage: string
  // 'entry fees' | 'badge fees', for the absorbed-fee breakdown line.
  feesLabel: string
}

// Payout status for either paid-event kind: fees transfer to the
// organization's Stripe account when the event completes
// (payments/payouts.ts); blocked or failed payouts retry from here, as do
// refunds whose executor gave up (they block the payout until settled) —
// one at a time, or all at once when a mass stall parked many. The
// wrappers supply the query results and the retry verbs.
export function PaidEventPayoutCard({
  isPaid,
  completed,
  payout,
  refundsNeedingAttention,
  onRetry,
  onRetryRefund,
  onRetryAllRefunds,
  copy,
}: {
  isPaid: boolean
  completed: boolean
  // undefined while loading (or while the query is skipped pre-completion).
  payout: PayoutSummary | undefined
  refundsNeedingAttention: RefundsNeedingAttention | undefined
  onRetry: () => Promise<unknown>
  onRetryRefund: (
    refundId: RefundNeedingAttention['refundId'],
  ) => Promise<unknown>
  onRetryAllRefunds: () => Promise<unknown>
  copy: PaidEventPayoutCopy
}) {
  const { selectedOrganization } = useOrganization()
  const [retrying, setRetrying] = useState(false)
  // The refund re-drive in flight: a row id, 'all' for the bulk verb.
  const [retryingRefund, setRetryingRefund] = useState<
    RefundNeedingAttention['refundId'] | 'all' | null
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

  async function handleRetryRefund(
    refundId: RefundNeedingAttention['refundId'],
  ) {
    setRetryingRefund(refundId)
    try {
      await onRetryRefund(refundId)
      toast.success('Refund retry started.')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not retry the refund.'))
    } finally {
      setRetryingRefund(null)
    }
  }

  async function handleRetryAllRefunds() {
    setRetryingRefund('all')
    try {
      await onRetryAllRefunds()
      toast.success('Retrying every refund that needs attention.')
    } catch (error) {
      toast.error(mutationErrorMessage(error, 'Could not retry the refunds.'))
    } finally {
      setRetryingRefund(null)
    }
  }

  const parkedRefunds = refundsNeedingAttention?.refunds ?? []
  const offerRetryAll =
    parkedRefunds.length > 1 || (refundsNeedingAttention?.hasMore ?? false)

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
                    Refund of {formatCents(refund.amountCents)} to{' '}
                    {refund.playerName ?? 'a player'} failed after{' '}
                    {refund.attemptCount}{' '}
                    {refund.attemptCount === 1 ? 'attempt' : 'attempts'} and
                    needs attention.
                  </span>
                  {refund.lastError ? (
                    <span className="text-muted-foreground">
                      {refund.lastError}
                    </span>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canRetry || retryingRefund !== null}
                  onClick={() => void handleRetryRefund(refund.refundId)}
                >
                  {retryingRefund === refund.refundId ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  Retry refund
                </Button>
              </li>
            ))}
          </ul>
          {refundsNeedingAttention?.hasMore ? (
            <p className="text-sm text-muted-foreground">
              More refunds need attention than are shown here.
            </p>
          ) : null}
          {offerRetryAll ? (
            <div>
              <Button
                type="button"
                variant="outline"
                disabled={!canRetry || retryingRefund !== null}
                onClick={() => void handleRetryAllRefunds()}
              >
                {retryingRefund === 'all' ? (
                  <Spinner data-icon="inline-start" />
                ) : null}
                Retry all refunds
              </Button>
            </div>
          ) : null}
          {!canRetry && (
            <p className="text-sm text-muted-foreground">
              Only the organization owner can retry a refund.
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
