import { Link } from '@tanstack/react-router'
import { useQuery } from 'convex/react'
import { CalendarDays, LogIn, ShieldCheck, Users } from 'lucide-react'
import { api } from '@tournament-os/backend/convex/_generated/api'

import { PublicSiteHeader } from '@/components/shared/public-site-header'
import { TournamentTable } from '@/components/tournaments'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { useAppAuth } from '@/lib/use-app-auth'

export function PlayerHome() {
  const { user, loading, refreshAuth, signOut } = useAppAuth()
  const tournaments = useQuery(api.tournaments.lifecycle.listUpcomingPublic)
  const myTournaments = useQuery(
    api.tournaments.registrations.listMyTournaments,
    user ? {} : 'skip',
  )

  const publicItems = tournaments?.map((tournament) => ({
    key: tournament._id,
    organizationName: tournament.organizationName,
    registeredCount: tournament.registeredCount,
    tournament,
  }))
  const registeredItems = myTournaments?.map((entry) => ({
    key: entry.registration._id,
    organizationName: entry.organizationName,
    registeredCount: entry.registeredCount,
    registration: entry.registration,
    tournament: entry.tournament,
  }))

  return (
    <main className="min-h-svh bg-background text-foreground">
      <PublicSiteHeader
        subtitle="Player tournament finder"
        actions={
          <>
            <Button asChild type="button" variant="outline">
              <Link to="/admin">
                <ShieldCheck data-icon="inline-start" />
                Admin
              </Link>
            </Button>
            <AuthControls
              loading={loading}
              email={user?.email}
              onSignIn={() => void refreshAuth({ ensureSignedIn: true })}
              onSignOut={() => void signOut()}
            />
          </>
        }
      />

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8">
        {user ? (
          <TournamentTable variant="registered" items={registeredItems} />
        ) : null}

        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Player view
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal sm:text-4xl">
              Upcoming tournaments
            </h1>
          </div>
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 md:min-w-80">
            <StatusLine
              icon={CalendarDays}
              label="Showing public future events"
            />
            <StatusLine icon={Users} label="Open an event to register" />
          </div>
        </div>

        <Separator />

        <TournamentTable variant="public" items={publicItems} />
      </section>
    </main>
  )
}

function AuthControls({
  loading,
  email,
  onSignIn,
  onSignOut,
}: {
  loading: boolean
  email?: string
  onSignIn: () => void
  onSignOut: () => void
}) {
  if (loading) {
    return (
      <Button type="button" variant="outline" size="icon" disabled>
        <Spinner />
        <span className="sr-only">Loading authentication</span>
      </Button>
    )
  }

  if (email) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-48 truncate text-sm text-muted-foreground lg:inline">
          {email}
        </span>
        <Button type="button" variant="outline" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    )
  }

  return (
    <Button type="button" variant="outline" onClick={onSignIn}>
      <LogIn data-icon="inline-start" />
      Sign in
    </Button>
  )
}

function StatusLine({
  icon: Icon,
  label,
}: {
  icon: typeof CalendarDays
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}
