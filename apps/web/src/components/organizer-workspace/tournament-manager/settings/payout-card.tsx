import { useState } from 'react'
import { useAction, useQuery } from 'convex/react'
import { toast } from 'sonner'

import { api } from '@paper-pairings/backend/convex/_generated/api'
import { mutationErrorMessage } from '@paper-pairings/core'
import { canManageOrganizationPayments } from '@paper-pairings/shared/organizer-utils'
import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
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

function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

// Payout status for a paid tournament: entry fees transfer to the
// organization's Stripe account when the tournament completes
// (payments/payouts.ts); blocked or failed payouts retry from here.
export function PayoutCard({ tournament }: { tournament: Doc<'tournaments'> }) {
  const { selectedOrganization } = useOrganization()
  const payout = useQuery(
    api.payments.payouts.getTournamentPayout,
    tournament.lifecycle === 'completed'
      ? { tournamentId: tournament._id }
      : 'skip',
  )
  const retryPayout = useAction(api.payments.payouts.retryPayout)
  const [retrying, setRetrying] = useState(false)

  const isPaid = (tournament.entryFeeCents ?? 0) > 0
  if (!isPaid) {
    return null
  }

  const canRetry = selectedOrganization
    ? canManageOrganizationPayments(selectedOrganization.membership.role)
    : false

  async function handleRetry() {
    setRetrying(true)
    try {
      await retryPayout({ tournamentId: tournament._id })
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
        <CardTitle>Entry fee payout</CardTitle>
        <CardDescription>
          Entry fees are transferred to the organization&apos;s Stripe account
          when the tournament completes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {tournament.lifecycle !== 'completed' ? (
          <p className="text-sm text-muted-foreground">
            The payout runs automatically once the tournament is completed.
          </p>
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
                {formatCents(payout.totalEntryCents)} in entry fees −{' '}
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
