import { useEffect, useRef, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useAction } from 'convex/react'
import { toast } from 'sonner'
import { api } from '@tournament-os/backend/convex/_generated/api'
import { mutationErrorMessage } from '@tournament-os/core'
import { AdminViewsLayout } from '@/components/organizer-workspace/admin-views-layout'
import { useOrganization } from '@/components/organizer-workspace/organization-context'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'

// Landing page for Stripe Connect onboarding redirects. Stripe sends the
// organizer here both on completion/exit (return_url) and when a link is
// expired or already used (refresh_url, tagged ?refresh=1). The redirect
// carries no state, so the page re-syncs the capability snapshot and reads
// the outcome from it.
export const Route = createFileRoute('/admin/stripe-return')({
  // Lenient by design: a mangled or missing param degrades to the plain
  // return flow instead of an error boundary.
  validateSearch: (search: Record<string, unknown>): { refresh?: string } => ({
    refresh: typeof search.refresh === 'string' ? search.refresh : undefined,
  }),
  component: RouteComponent,
})

type SyncState =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'incomplete' }
  | { kind: 'error'; message: string }

function RouteComponent() {
  const { refresh } = Route.useSearch()
  const { selectedOrganizationId, organizations } = useOrganization()

  const refreshAccountStatus = useAction(
    api.payments.connect.refreshAccountStatus,
  )
  const createOnboardingLink = useAction(
    api.payments.connect.createOnboardingLink,
  )

  const [sync, setSync] = useState<SyncState>({ kind: 'checking' })
  const [resuming, setResuming] = useState(false)

  // One snapshot refresh per landing, once the selected organization is
  // known; a strict-mode double mount must not double-hit Stripe.
  const syncedOrganizationId = useRef<string | null>(null)
  useEffect(() => {
    if (
      !selectedOrganizationId ||
      syncedOrganizationId.current === selectedOrganizationId
    ) {
      return
    }
    syncedOrganizationId.current = selectedOrganizationId

    void (async () => {
      try {
        const { payoutsReady } = await refreshAccountStatus({
          organizationId: selectedOrganizationId,
        })
        setSync({ kind: payoutsReady ? 'ready' : 'incomplete' })
      } catch (error) {
        setSync({
          kind: 'error',
          message: mutationErrorMessage(
            error,
            'Could not check the Stripe account status.',
          ),
        })
      }
    })()
  }, [selectedOrganizationId, refreshAccountStatus])

  async function handleResumeOnboarding() {
    if (!selectedOrganizationId) {
      return
    }

    setResuming(true)
    try {
      const { url } = await createOnboardingLink({
        organizationId: selectedOrganizationId,
      })
      window.location.assign(url)
    } catch (error) {
      toast.error(
        mutationErrorMessage(error, 'Could not resume Stripe onboarding.'),
      )
      setResuming(false)
    }
  }

  const expiredLink = refresh !== undefined

  return (
    <AdminViewsLayout>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Stripe onboarding</CardTitle>
          <CardDescription>
            {expiredLink
              ? 'That onboarding link expired or was already used.'
              : 'Welcome back from Stripe.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {organizations !== undefined && !selectedOrganizationId ? (
            <p className="text-sm text-muted-foreground">
              No organization is selected. Pick one from the admin workspace,
              then manage payments from its organization page.
            </p>
          ) : sync.kind === 'checking' ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner data-icon="inline-start" />
              Checking your Stripe account status
            </p>
          ) : sync.kind === 'ready' ? (
            <p className="text-sm">
              Your Stripe account is connected and ready for payouts.
            </p>
          ) : sync.kind === 'incomplete' ? (
            <p className="text-sm text-muted-foreground">
              Onboarding is not finished yet — Stripe still needs more
              information before this organization can receive payouts.
            </p>
          ) : (
            <p className="text-sm text-destructive">{sync.message}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {(sync.kind === 'incomplete' || expiredLink) && (
              <Button
                onClick={() => void handleResumeOnboarding()}
                disabled={resuming || !selectedOrganizationId}
              >
                {resuming ? <Spinner data-icon="inline-start" /> : null}
                Continue onboarding
              </Button>
            )}
            <Button variant="outline" asChild>
              <Link to="/admin/organization">Back to organization</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </AdminViewsLayout>
  )
}
