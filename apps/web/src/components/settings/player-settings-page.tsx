import { Link } from '@tanstack/react-router'
import {
  AuthLoading,
  Authenticated,
  Unauthenticated,
  useMutation,
  useQuery,
} from 'convex/react'
import { ArrowLeft, LogIn } from 'lucide-react'
import { useEffect } from 'react'
import { api } from '@tournament-os/backend/convex/_generated/api'

import { ProfilePrivacyCard } from '@/components/settings/profile-privacy-card'
import { PublicSiteHeader } from '@/components/shared/public-site-header'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Toaster } from '@/components/ui/sonner'
import { useAppAuth } from '@/lib/use-app-auth'

export function PlayerSettingsPage() {
  return (
    <main className="min-h-svh bg-background text-foreground">
      <PublicSiteHeader
        maxWidth="4xl"
        subtitle="Account settings"
        actions={
          <Button asChild type="button" variant="ghost">
            <Link to="/">
              <ArrowLeft data-icon="inline-start" />
              All tournaments
            </Link>
          </Button>
        }
      />

      <section className="mx-auto grid max-w-4xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <AuthLoading>
          <LoadingCard />
        </AuthLoading>
        <Unauthenticated>
          <SignedOutSettings />
        </Unauthenticated>
        <Authenticated>
          <SettingsContent />
        </Authenticated>
      </section>
      <Toaster />
    </main>
  )
}

function SettingsContent() {
  // A Clerk session can exist before its users row does (first visit); the
  // upsert also refreshes name/avatar from the identity.
  const upsertMe = useMutation(api.users.upsertMe)
  useEffect(() => {
    void upsertMe()
  }, [upsertMe])

  const me = useQuery(api.users.me)
  if (me === undefined || me === null) {
    return <LoadingCard />
  }

  return <ProfilePrivacyCard me={me} />
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
