import { useState } from 'react'
import { toast } from 'sonner'

import { mutationErrorMessage } from '@tournament-os/core'
import { canManageOrganizationPayments } from '@tournament-os/shared/organizer-utils'
import { formatCents } from './money'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '@tournament-os/backend/convex/_generated/api'
import { useOrganization } from '@/components/organizer-workspace/organization-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'

type PayoutSummary = FunctionReturnType<
  typeof api.payments.payouts.getTournamentPayout
>

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
// (payments/payouts.ts); blocked or failed payouts retry from here. The
// wrappers supply the payout query result and the retry action.
export function PaidEventPayoutCard({
  isPaid,
  completed,
  payout,
  onRetry,
  copy,
}: {
  isPaid: boolean
  completed: boolean
  // undefined while loading (or while the query is skipped pre-completion).
  payout: PayoutSummary | undefined
  onRetry: () => Promise<unknown>
  copy: PaidEventPayoutCopy
}) {
  const { selectedOrganization } = useOrganization()
  const [retrying, setRetrying] = useState(false)

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

  return (
    <Card>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
      </CardContent>
    </Card>
  )
}
