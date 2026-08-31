import { useState } from 'react'
import { useAction, useQuery } from 'convex/react'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@paper-pairings/backend/convex/_generated/api'
import { mutationErrorMessage } from '@paper-pairings/core'
import { useOrganization } from './organization-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

type PaymentsBusy = 'connect' | 'refresh' | null

const statusLabels = {
  pending: 'Onboarding incomplete',
  active: 'Payouts ready',
  restricted: 'Action required',
  unsupported: 'Not supported',
} as const

// Stripe Connect card on the organization profile page. Connecting redirects
// to Stripe-hosted onboarding and lands back on /admin/stripe-return, which
// refreshes the capability snapshot this card renders.
export function OrganizationPaymentsCard() {
  const { selectedOrganizationId } = useOrganization()

  const settings = useQuery(
    api.payments.connect.getOrganizationPaymentSettings,
    selectedOrganizationId
      ? { organizationId: selectedOrganizationId }
      : 'skip',
  )
  const createOnboardingLink = useAction(
    api.payments.connect.createOnboardingLink,
  )
  const refreshAccountStatus = useAction(
    api.payments.connect.refreshAccountStatus,
  )

  const [busy, setBusy] = useState<PaymentsBusy>(null)

  async function handleConnect() {
    if (!selectedOrganizationId) {
      return
    }

    setBusy('connect')
    try {
      const { url } = await createOnboardingLink({
        organizationId: selectedOrganizationId,
      })
      window.location.assign(url)
    } catch (error) {
      toast.error(
        mutationErrorMessage(error, 'Could not start Stripe onboarding.'),
      )
      setBusy(null)
    }
  }

  async function handleRefresh() {
    if (!selectedOrganizationId) {
      return
    }

    setBusy('refresh')
    try {
      const { payoutsReady } = await refreshAccountStatus({
        organizationId: selectedOrganizationId,
      })
      toast.success(
        payoutsReady
          ? 'Stripe account is ready for payouts.'
          : 'Stripe status refreshed.',
      )
    } catch (error) {
      toast.error(
        mutationErrorMessage(error, 'Could not refresh Stripe status.'),
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
        <CardDescription>
          Connect a Stripe account to charge entry fees and receive payouts for
          your events.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {settings === undefined ? (
          <Skeleton className="h-16" />
        ) : !settings.stripeConfigured ? (
          <p className="text-sm text-muted-foreground">
            Payments are not configured for this deployment.
          </p>
        ) : settings.connection === null ? (
          <>
            <Button
              onClick={() => void handleConnect()}
              disabled={!settings.canManage || busy !== null}
            >
              {busy === 'connect' ? <Spinner data-icon="inline-start" /> : null}
              Connect Stripe
            </Button>
            {!settings.canManage && (
              <p className="text-sm text-muted-foreground">
                Only the organization owner can manage payments.
              </p>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  settings.connection.payoutsReady ? 'default' : 'secondary'
                }
              >
                {statusLabels[settings.connection.transfersCapabilityStatus]}
              </Badge>
            </div>
            {!settings.connection.payoutsReady && (
              <p className="text-sm text-muted-foreground">
                Stripe needs more information before this organization can
                receive payouts.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!settings.connection.payoutsReady && (
                <Button
                  onClick={() => void handleConnect()}
                  disabled={!settings.canManage || busy !== null}
                >
                  {busy === 'connect' ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  Continue onboarding
                </Button>
              )}
              <Button
                variant="outline"
                onClick={() => void handleRefresh()}
                disabled={!settings.canManage || busy !== null}
              >
                {busy === 'refresh' ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RefreshCw data-icon="inline-start" />
                )}
                Refresh status
              </Button>
            </div>
            {!settings.canManage && (
              <p className="text-sm text-muted-foreground">
                Only the organization owner can manage payments.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
