import {
  AuthLoading,
  Authenticated,
  Unauthenticated,
  useQuery,
} from 'convex/react'
import { LogIn, RotateCcw } from 'lucide-react'
import { api } from '@tournament-os/backend/convex/_generated/api'

import { ProfilePrivacyCard } from '@/components/settings/profile-privacy-card'
import { SiteShell, SiteShellBackLink } from '@/components/shared/site-shell'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { useEnsureUserRow } from '@/hooks/use-ensure-user-row'
import { useAppAuth } from '@/lib/use-app-auth'

export function PlayerSettingsPage() {
  return (
    <SiteShell
      subtitle="Account settings"
      toaster
      actions={<SiteShellBackLink to="/">All tournaments</SiteShellBackLink>}
    >
      <AuthLoading>
        <LoadingCard />
      </AuthLoading>
      <Unauthenticated>
        <SignedOutSettings />
      </Unauthenticated>
      <Authenticated>
        <SettingsContent />
      </Authenticated>
    </SiteShell>
  )
}

function SettingsContent() {
  // A Clerk session can exist before its users row does (first visit); the
  // upsert also refreshes name/avatar from the identity.
  const { failed: upsertFailed, retry: retryUpsert } = useEnsureUserRow()

  const me = useQuery(api.users.me)
  if (me === undefined) {
    return <LoadingCard />
  }
  if (me === null) {
    // No users row yet: the mount upsert is creating it, and the query
    // re-renders with the row once it lands. If the upsert rejected instead,
    // nothing else will ever resolve this state — surface it with a retry.
    return upsertFailed ? (
      <AccountSetupFailedCard onRetry={retryUpsert} />
    ) : (
      <LoadingCard />
    )
  }

  return <ProfilePrivacyCard me={me} />
}

function AccountSetupFailedCard({ onRetry }: { onRetry: () => void }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Couldn&apos;t load your account</CardTitle>
        <CardDescription>
          Something went wrong while setting up your player account. Check your
          connection and try again.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" onClick={onRetry}>
          <RotateCcw data-icon="inline-start" />
          Try again
        </Button>
      </CardContent>
    </Card>
  )
}

function SignedOutSettings() {
  const { refreshAuth } = useAppAuth()

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to manage your settings</CardTitle>
        <CardDescription>
          Profile privacy and tournament history controls are tied to your
          player account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          type="button"
          onClick={() => void refreshAuth({ ensureSignedIn: true })}
        >
          <LogIn data-icon="inline-start" />
          Sign in
        </Button>
      </CardContent>
    </Card>
  )
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Loading settings</CardTitle>
        <CardDescription>Fetching your account.</CardDescription>
      </CardHeader>
      <CardContent>
        <TableLoadingSkeleton />
      </CardContent>
    </Card>
  )
}
