import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useConvexAuth, useMutation, useQuery } from 'convex/react'
import {
  Building2,
  CalendarDays,
  LogIn,
  SearchX,
  Swords,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@tournament-os/backend/convex/_generated/api'
import type { Doc } from '@tournament-os/backend/convex/_generated/dataModel'
import { MarkdownContent } from '@/components/shared/markdown-content'
import { RoundTimerIndicator } from '@/components/shared/round-timer-indicator'
import { SiteShell, SiteShellBackLink } from '@/components/shared/site-shell'
import { TableLoadingSkeleton } from '@/components/shared/table-loading-skeleton'
import {
  TournamentLifecycleBadge,
  formatTournamentDateLong,
} from '@/components/tournaments'
import { useAppAuth } from '@/lib/use-app-auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

type Tournament = Doc<'tournaments'>

export function TournamentPublicPage({ publicCode }: { publicCode: string }) {
  return (
    <SiteShell
      subtitle="Tournament details"
      toaster
      actions={<SiteShellBackLink to="/">All tournaments</SiteShellBackLink>}
    >
      <TournamentPublicPageContent publicCode={publicCode} />
    </SiteShell>
  )
}

// The public event card without the page chrome, so the admin Overview can
// embed the same view as an organizer preview of what players see.
export function TournamentPublicPageContent({
  publicCode,
}: {
  publicCode: string
}) {
  const event = useQuery(api.tournaments.lifecycle.getPublicTournament, {
    publicCode,
  })

  return event === undefined ? (
    <LoadingCard />
  ) : event === null ? (
    <NotFound />
  ) : (
    <TournamentDetails
      tournament={event.tournament}
      organizationName={event.organizationName}
      registeredCount={event.registeredCount}
    />
  )
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Loading tournament</CardTitle>
        <CardDescription>Fetching event details.</CardDescription>
      </CardHeader>
      <CardContent>
        <TableLoadingSkeleton />
      </CardContent>
    </Card>
  )
}

function NotFound() {
  return (
    <Empty className="min-h-80 border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>Tournament not found</EmptyTitle>
        <EmptyDescription>
          This event does not exist or is not open to the public.
        </EmptyDescription>
      </EmptyHeader>
      <Button asChild type="button" variant="outline">
        <Link to="/">Browse upcoming tournaments</Link>
      </Button>
    </Empty>
  )
}

function TournamentDetails({
  tournament,
  organizationName,
  registeredCount,
}: {
  tournament: Tournament
  organizationName: string | null
  registeredCount: number
}) {
  const spotsLeft = Math.max(tournament.playerCapacity - registeredCount, 0)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-2xl">{tournament.name}</CardTitle>
          <TournamentLifecycleBadge lifecycle={tournament.lifecycle} />
          <RoundTimerIndicator timer={tournament.roundTimer} />
        </div>
        <CardDescription>
          {tournament.isTestEvent ? 'Test event' : 'Public event'}
          {organizationName ? ` hosted by ${organizationName}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <DetailLine
            icon={CalendarDays}
            label="Starts"
            value={formatTournamentDateLong(tournament.startDate)}
          />
          <DetailLine
            icon={Swords}
            label="Format"
            value={tournament.format}
            capitalize
          />
          <DetailLine
            icon={Users}
            label="Players"
            value={`${registeredCount} of ${tournament.playerCapacity} registered`}
          />
          {organizationName ? (
            <DetailLine
              icon={Building2}
              label="Organizer"
              value={organizationName}
            />
          ) : null}
        </div>
        <Separator />
        <RegistrationPanel tournament={tournament} spotsLeft={spotsLeft} />
        {tournament.detailsMarkdown ? (
          <>
            <Separator />
            <MarkdownContent markdown={tournament.detailsMarkdown} />
          </>
        ) : null}
      </CardContent>
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          Pairings and standings will be available here once the event begins.
        </p>
      </CardFooter>
    </Card>
  )
}

function DetailLine({
  icon: Icon,
  label,
  value,
  capitalize = false,
}: {
  icon: typeof CalendarDays
  label: string
  value: string
  capitalize?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn('font-medium', capitalize && 'capitalize')}>
        {value}
      </span>
    </div>
  )
}

function RegistrationPanel({
  tournament,
  spotsLeft,
}: {
  tournament: Tournament
  spotsLeft: number
}) {
  const { user, loading, refreshAuth } = useAppAuth()
  const { isAuthenticated: convexAuthed } = useConvexAuth()
  // Gated on Convex auth, not just the Clerk user: the server resolves the
  // registration from its own identity, so running this while Convex is
  // still exchanging tokens returns null — which would flash the register
  // button at an already-registered player. Skipping keeps it undefined,
  // holding the "Checking your registration" state until an answer can be
  // trusted.
  const registration = useQuery(
    api.tournaments.registrations.getMyRegistration,
    user && convexAuthed ? { tournamentId: tournament._id } : 'skip',
  )
  const registerSelf = useMutation(api.tournaments.registrations.registerSelf)
  const cancelRegistration = useMutation(
    api.tournaments.registrations.cancelMyRegistration,
  )
  const [pending, setPending] = useState(false)

  const runAction = async (
    action: () => Promise<unknown>,
    successMessage: string,
  ) => {
    setPending(true)
    try {
      await action()
      toast.success(successMessage)
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Something went wrong',
      )
    } finally {
      setPending(false)
    }
  }

  if (loading) {
    return (
      <Button type="button" variant="outline" disabled className="w-fit">
        <Spinner />
        Checking your registration
      </Button>
    )
  }

  if (!user) {
    if (tournament.lifecycle !== 'registration') {
      return (
        <p className="text-sm text-muted-foreground">
          Registration is closed for this event.
        </p>
      )
    }
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={() => void refreshAuth({ ensureSignedIn: true })}
        >
          <LogIn data-icon="inline-start" />
          Sign in to register
        </Button>
        <p className="text-sm text-muted-foreground">
          {spotsLeft === 1 ? '1 spot left' : `${spotsLeft} spots left`}
        </p>
      </div>
    )
  }

  if (registration === undefined) {
    return (
      <Button type="button" variant="outline" disabled className="w-fit">
        <Spinner />
        Checking your registration
      </Button>
    )
  }

  if (
    registration?.entryStatus === 'confirmed' &&
    registration.participationStatus === 'active'
  ) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge>You&apos;re registered</Badge>
        {tournament.lifecycle === 'registration' ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              void runAction(
                () => cancelRegistration({ tournamentId: tournament._id }),
                'Your registration has been cancelled.',
              )
            }
          >
            {pending ? <Spinner /> : null}
            Cancel registration
          </Button>
        ) : tournament.lifecycle === 'in_progress' ? (
          <Button asChild type="button">
            <Link
              to="/tournaments/$tournamentId/play"
              params={{ tournamentId: String(tournament.publicCode) }}
            >
              <Swords data-icon="inline-start" />
              Open player controller
            </Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            The event has started, so registration changes are locked.
          </p>
        )}
      </div>
    )
  }

  // A withdrawn player still holds their confirmed seat (a mid-play drop, or
  // one preserved by a round-one rewind back into registration), and the
  // server masks a disqualification as a drop, so this branch covers both.
  // Before play the only self-service action the server accepts is cancelling
  // to release the seat; rejoining is an organizer-side reinstatement. While
  // the event runs, the player controller still admits every confirmed seat,
  // so keep its entry point available for standings and match history.
  if (
    registration?.entryStatus === 'confirmed' &&
    registration.participationStatus === 'dropped'
  ) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">You withdrew from this event</Badge>
        {tournament.lifecycle === 'registration' ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              void runAction(
                () => cancelRegistration({ tournamentId: tournament._id }),
                'Your registration has been cancelled.',
              )
            }
          >
            {pending ? <Spinner /> : null}
            Cancel registration
          </Button>
        ) : tournament.lifecycle === 'in_progress' ? (
          <>
            <Button asChild type="button">
              <Link
                to="/tournaments/$tournamentId/play"
                params={{ tournamentId: String(tournament.publicCode) }}
              >
                <Swords data-icon="inline-start" />
                Open player controller
              </Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              You can still follow standings and your match history.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            The event has started, so registration changes are locked.
          </p>
        )}
      </div>
    )
  }

  // An eliminated player is out of contention but keeps their confirmed seat,
  // and the player controller still admits them, so while the event runs it
  // stays their route to live standings and their match history.
  if (
    registration?.entryStatus === 'confirmed' &&
    registration.participationStatus === 'eliminated'
  ) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">
          You&apos;ve been eliminated from this event
        </Badge>
        {tournament.lifecycle === 'in_progress' ? (
          <>
            <Button asChild type="button">
              <Link
                to="/tournaments/$tournamentId/play"
                params={{ tournamentId: String(tournament.publicCode) }}
              >
                <Swords data-icon="inline-start" />
                Open player controller
              </Link>
            </Button>
            <p className="text-sm text-muted-foreground">
              You can still follow standings and your match history.
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            The event has started, so registration changes are locked.
          </p>
        )}
      </div>
    )
  }

  if (tournament.lifecycle !== 'registration') {
    return (
      <p className="text-sm text-muted-foreground">
        Registration is closed for this event.
      </p>
    )
  }

  if (spotsLeft === 0) {
    return (
      <Button type="button" variant="outline" disabled className="w-fit">
        Tournament is full
      </Button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        disabled={pending}
        onClick={() =>
          void runAction(
            () => registerSelf({ tournamentId: tournament._id }),
            "You're registered. See you at the event!",
          )
        }
      >
        {pending ? <Spinner /> : null}
        Register for this event
      </Button>
      <p className="text-sm text-muted-foreground">
        {spotsLeft === 1 ? '1 spot left' : `${spotsLeft} spots left`}
      </p>
    </div>
  )
}
