import { useState } from 'react'
import { useAction, useQuery } from 'convex/react'
import { ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@paper-pairings/backend/convex/_generated/api'
import { mutationErrorMessage } from '@paper-pairings/core'
import { SUPPORTED_STRIPE_COUNTRIES } from '@paper-pairings/shared/payment-fees'
import { useOrganization } from './organization-context'
import { SectionHeader } from '@/components/shared/section-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldContent, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'

type PaymentsBusy = 'connect' | 'refresh' | 'dashboard' | null

const statusLabels = {
  pending: 'Onboarding incomplete',
  active: 'Payouts ready',
  restricted: 'Action required',
  rejected: 'Account rejected',
  unsupported: 'Not supported',
} as const

// Stripe Connect section on the organization profile page. Connecting
// redirects to Stripe-hosted onboarding and lands back on
// /admin/stripe-return, which refreshes the capability snapshot this renders.
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
  const createDashboardLink = useAction(
    api.payments.connect.createDashboardLink,
  )

  const [busy, setBusy] = useState<PaymentsBusy>(null)
  // Stripe fixes a connected account's country at creation and the platform
  // pays out in USD only, so the first connect asks the owner to confirm the
  // organization is US-based instead of silently creating a US account that
  // a non-US organizer could never finish onboarding.
  const [confirmedUsBased, setConfirmedUsBased] = useState(false)

  // Stripe login links are single-use and short-lived, so one is minted per
  // click and followed immediately, like the onboarding link.
  async function handleOpenDashboard() {
    if (!selectedOrganizationId) {
      return
    }

    setBusy('dashboard')
    try {
      const { url } = await createDashboardLink({
        organizationId: selectedOrganizationId,
      })
      window.location.assign(url)
    } catch (error) {
      toast.error(
        mutationErrorMessage(error, 'Could not open the Stripe dashboard.'),
      )
      setBusy(null)
    }
  }

  // Serves both the first connect (country required) and "continue
  // onboarding" (the account exists, so the country is ignored server-side).
  async function handleConnect() {
    if (!selectedOrganizationId) {
      return
    }

    setBusy('connect')
    try {
      const { url } = await createOnboardingLink({
        organizationId: selectedOrganizationId,
        country: SUPPORTED_STRIPE_COUNTRIES[0],
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
    <section className="flex flex-col gap-4">
      <SectionHeader
        title="Payments"
        description="Connect a Stripe account to charge entry fees and receive payouts for your events."
      />
      <div className="flex flex-col gap-4">
        {settings === undefined ? (
          <Skeleton className="h-16" />
        ) : !settings.stripeConfigured ? (
          <p className="text-sm text-muted-foreground">
            Payments are not configured for this deployment.
          </p>
        ) : settings.connection === null ? (
          <>
            <p className="text-sm text-muted-foreground">
              Stripe payouts are currently available to organizations based in
              the United States only. Onboarding asks for a US bank account and
              US tax details, and the account&apos;s country cannot be changed
              later. Support for other countries is planned.
            </p>
            <Field
              orientation="horizontal"
              data-disabled={!settings.canManage || busy !== null}
            >
              <Checkbox
                id="stripe-us-based"
                checked={confirmedUsBased}
                onCheckedChange={(checked) =>
                  setConfirmedUsBased(checked === true)
                }
                disabled={!settings.canManage || busy !== null}
              />
              <FieldContent>
                <FieldLabel htmlFor="stripe-us-based">
                  This organization is based in the United States
                </FieldLabel>
              </FieldContent>
            </Field>
            <Button
              onClick={() => void handleConnect()}
              disabled={
                !settings.canManage || busy !== null || !confirmedUsBased
              }
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
                variant={
                  settings.connection.payoutsReady ? 'default' : 'outline'
                }
                onClick={() => void handleOpenDashboard()}
                disabled={!settings.canManage || busy !== null}
              >
                {busy === 'dashboard' ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <ExternalLink data-icon="inline-start" />
                )}
                Open Stripe dashboard
              </Button>
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
      </div>
    </section>
  )
}
