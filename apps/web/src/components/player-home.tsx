import { Link } from '@tanstack/react-router'
import { useMyTournaments } from '@paper-pairings/core'
import { useQuery } from 'convex/react'
import { CalendarDays, LogIn, Settings, ShieldCheck, Users } from 'lucide-react'
import { api } from '@paper-pairings/backend/convex/_generated/api'

import type { TournamentTableSearchParams } from '@/components/tournaments'
import { SiteShell } from '@/components/shared/site-shell'
import { TournamentTable } from '@/components/tournaments'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { useAppAuth } from '@/lib/use-app-auth'

export function PlayerHome({
  scheduleSearch,
  onScheduleSearchChange,
}: {
  // Only the public schedule's toolbar is addressable from the URL; the
  // registered list shares the page and keeps its own state.
  scheduleSearch: TournamentTableSearchParams
  onScheduleSearchChange: (next: TournamentTableSearchParams) => void
}) {
  const { user, loading, refreshAuth, signOut } = useAppAuth()
  const tournaments = useQuery(api.tournaments.lifecycle.listUpcomingPublic)
  const conventions = useQuery(api.conventions.lifecycle.listUpcomingPublic)
  const myTournaments = useMyTournaments()

  // The public schedule groups each convention's events under it, so both
  // lists load before the table renders rather than regrouping afterwards.
  const publicLoaded = tournaments !== undefined && conventions !== undefined
  const publicItems = publicLoaded
    ? tournaments.map((tournament) => ({
        key: tournament._id,
        organizationName: tournament.organizationName,
        registeredCount: tournament.registeredCount,
        tournament,
      }))
    : undefined
  const conventionItems = publicLoaded
    ? conventions.map((convention) => ({
        key: convention._id,
        organizationName: convention.organizationName,
        registeredCount: convention.registeredCount,
        convention,
      }))
    : undefined
  const registeredItems = myTournaments?.map((entry) => ({
    key: entry.registration._id,
    organizationName: entry.organizationName,
    registeredCount: entry.registeredCount,
    registration: entry.registration,
    tournament: entry.tournament,
  }))

  return (
    <SiteShell
      subtitle="Player tournament finder"
      contentClassName="gap-8"
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
    >
      {user ? (
        <TournamentTable variant="registered" items={registeredItems} />
      ) : null}

      <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
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

      {/* Conventions sit in the schedule as collapsible groups with their
          child events nested beneath them; a child whose convention is not
          public still lists on its own (TODO §4: standalone discovery is
          preserved). */}
      <TournamentTable
        variant="public"
        items={publicItems}
        conventions={conventionItems}
        search={scheduleSearch}
        onSearchChange={onScheduleSearchChange}
      />
    </SiteShell>
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
        <Button asChild type="button" variant="outline" size="icon">
          <Link to="/settings" aria-label="Account settings">
            <Settings />
          </Link>
        </Button>
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
