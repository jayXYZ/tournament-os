import { useState } from 'react'
import { toast } from 'sonner'

import { mutationErrorMessage } from '@paper-pairings/core'
import { canManageOrganizationPayments } from '@paper-pairings/shared/organizer-utils'
import type { UsePaginatedQueryReturnType } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '@paper-pairings/backend/convex/_generated/api'
import { LoadMoreButton } from '@/components/shared/load-more-button'
import { SectionHeader } from '@/components/shared/section-header'
import { formatCents } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useOrganization } from '@/components/organizer-workspace/organization-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

type PayoutSummary = FunctionReturnType<
  typeof api.payments.payouts.getTournamentPayout
>
// One of the card's two refund lists (unresolved, processing) as
// usePaginatedQuery hands it over: the rows loaded so far, the paging
// status, and loadMore.
export type RefundsNeedingAttention = UsePaginatedQueryReturnType<
  typeof api.payments.refunds.listRefundsNeedingAttention
>
type RefundNeedingAttention = RefundsNeedingAttention['results'][number]
type RefundStatusCheck = FunctionReturnType<
  typeof api.payments.refunds.checkRefundStatus
>

// How many refunds each list loads per page; the wrappers pass it as the
// initial page size and the card asks for the same again on each load.
// Under the backend's cap (REFUNDS_NEEDING_ATTENTION_PAGE): a card with
// more rows than this has a mass stall on its hands and pages through it.
export const REFUNDS_NEEDING_ATTENTION_PAGE_SIZE = 20

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
    case 'conflict':
      return {
        kind: 'warning' as const,
        message: `Stripe holds a second refund for this entry besides the one on record. Nothing was changed. ${contactOperator}`,
      }
    case 'check_failed':
      return {
        kind: 'error' as const,
        message: `Could not check this refund with Stripe: ${check.message}`,
      }
  }
}

// One of the card's refund lists: the rows loaded so far, each with its
// check, and the button that loads the next page. Renders nothing while
// the list is empty, so a card with nothing stalled shows no refund rows
// at all.
function RefundList({
  list,
  loadMoreLabel,
  canCheck,
  checkingRefund,
  onCheck,
}: {
  list: RefundsNeedingAttention
  loadMoreLabel: string
  canCheck: boolean
  checkingRefund: RefundNeedingAttention['refundId'] | null
  onCheck: (refundId: RefundNeedingAttention['refundId']) => void
}) {
  if (list.results.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {list.results.map((refund) => (
          <li
            key={refund.refundId}
            className={cn(
              'flex flex-wrap items-center justify-between gap-2 rounded-md border p-3',
              refund.status === 'needs_attention' && 'border-destructive/40',
            )}
          >
            <div className="flex flex-col gap-1 text-sm">
              {refund.status === 'needs_attention' ? (
                <>
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
                    {refund.attemptCount === 1 ? 'attempt' : 'attempts'}).
                  </span>
                </>
              ) : (
                <>
                  <span>
                    Stripe is still processing the{' '}
                    {formatCents(refund.amountCents)} refund to{' '}
                    {refund.playerName ?? 'a player'}. The payout stays paused
                    until it settles.
                  </span>
                  <span className="text-muted-foreground">
                    It settles on its own once Stripe reports it; check its
                    status to confirm sooner (reference {refund.refundId}).
                  </span>
                </>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canCheck || checkingRefund !== null}
              onClick={() => onCheck(refund.refundId)}
            >
              {checkingRefund === refund.refundId ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              Check refund status
            </Button>
          </li>
        ))}
      </ul>
      <LoadMoreButton
        status={list.status}
        onLoadMore={() => list.loadMore(REFUNDS_NEEDING_ATTENTION_PAGE_SIZE)}
        label={loadMoreLabel}
      />
    </div>
  )
}

// Payout status for either paid-event kind: fees transfer to the
// organization's Stripe account when the event completes
// (payments/payouts.ts); blocked or failed payouts retry from here. Refunds
// whose outcome could not be confirmed, and refunds Stripe is still
// processing, block the payout and are listed above it — two lists, each
// paged on its own, so every such refund is reachable without settling the
// ones before it — each with a status check against Stripe's record. The
// check settles what Stripe knows about and never issues a refund itself.
// The wrappers supply the query results and the two verbs.
export function PaidEventPayoutCard({
  isPaid,
  completed,
  payout,
  unresolvedRefunds,
  processingRefunds,
  onRetry,
  onCheckRefund,
  copy,
}: {
  isPaid: boolean
  completed: boolean
  // undefined while loading (or while the query is skipped pre-completion).
  payout: PayoutSummary | undefined
  // The parked refunds (outcome unknown) and the ones Stripe is still
  // processing, each paged on its own.
  unresolvedRefunds: RefundsNeedingAttention
  processingRefunds: RefundsNeedingAttention
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

  const hasRefunds =
    unresolvedRefunds.results.length > 0 || processingRefunds.results.length > 0

  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={copy.title} description={copy.description} />
      {hasRefunds ? (
        <div className="flex flex-col gap-3">
          <RefundList
            list={unresolvedRefunds}
            loadMoreLabel="Load more unresolved refunds"
            canCheck={canRetry}
            checkingRefund={checkingRefund}
            onCheck={(refundId) => void handleCheckRefund(refundId)}
          />
          <RefundList
            list={processingRefunds}
            loadMoreLabel="Load more processing refunds"
            canCheck={canRetry}
            checkingRefund={checkingRefund}
            onCheck={(refundId) => void handleCheckRefund(refundId)}
          />
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
