
import { Link } from "@tanstack/react-router";
import { useAppAuth } from "@/lib/use-app-auth";
import { useQuery } from "convex/react";
import {
  CalendarDays,
  LogIn,
  ShieldCheck,
  Swords,
  Ticket,
  UserRound,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@tournament-os/backend/convex/_generated/api";
import type { Doc } from "@tournament-os/backend/convex/_generated/dataModel";

type Tournament = Doc<"tournaments">;

type MyTournamentEntry = {
  registration: Doc<"tournamentRegistrations">;
  tournament: Tournament;
  organizationName: string | null;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function PlayerHome() {
  const { user, loading, refreshAuth, signOut } = useAppAuth();
  const tournaments = useQuery(api.tournaments.lifecycle.listUpcomingPublic);
  const myTournaments = useQuery(
    api.tournaments.registrations.listMyTournaments,
    user ? {} : "skip",
  );

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Swords className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">
                Tournament OS
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Player tournament finder
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:px-8">
        {user ? <MyTournamentsSection entries={myTournaments} /> : null}

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

        <TournamentTable tournaments={tournaments} />
      </section>
    </main>
  );
}

function AuthControls({
  loading,
  email,
  onSignIn,
  onSignOut,
}: {
  loading: boolean;
  email?: string;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  if (loading) {
    return (
      <Button type="button" variant="outline" size="icon" disabled>
        <Spinner />
        <span className="sr-only">Loading authentication</span>
      </Button>
    );
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
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" onClick={onSignIn}>
        <LogIn data-icon="inline-start" />
        Sign in
      </Button>
    </div>
  );
}

function StatusLine({
  icon: Icon,
  label,
}: {
  icon: typeof CalendarDays;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

function MyTournamentsSection({
  entries,
}: {
  entries: MyTournamentEntry[] | undefined;
}) {
  if (entries === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My tournaments</CardTitle>
          <CardDescription>
            Checking your ongoing and upcoming registrations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {[0, 1].map((row) => (
              <Skeleton key={row} className="h-12" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>My tournaments</CardTitle>
          <CardDescription>
            You are not registered for any upcoming events yet. Pick one from
            the schedule below to get started.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>My tournaments</CardTitle>
        <CardDescription>
          Ongoing and upcoming events you are registered for.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>Tournament</TableHead>
              <TableHead>Organizer</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Start date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.registration._id}>
                <TableCell>
                  <p className="font-medium text-foreground">
                    {entry.tournament.name}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.tournament.isTestEvent
                      ? "Test event"
                      : "Public event"}
                  </p>
                </TableCell>
                <TableCell>{entry.organizationName ?? "—"}</TableCell>
                <TableCell className="capitalize">
                  {entry.tournament.format}
                </TableCell>
                <TableCell>
                  {dateFormatter.format(new Date(entry.tournament.startDate))}
                </TableCell>
                <TableCell>
                  {entry.tournament.status === "in_progress" ? (
                    <Badge>In progress</Badge>
                  ) : (
                    <Badge variant="secondary">Registered</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {entry.tournament.status === "in_progress" ? (
                    <Button asChild type="button">
                      <Link to="/tournaments/$tournamentId/play" params={{ tournamentId: entry.tournament._id }}>
                        <Swords data-icon="inline-start" />
                        Open player controller
                      </Link>
                    </Button>
                  ) : (
                    <Button asChild type="button" variant="outline">
                      <Link to="/tournaments/$tournamentId" params={{ tournamentId: entry.tournament._id }}>
                        <Ticket data-icon="inline-start" />
                        View event
                      </Link>
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TournamentTable({
  tournaments,
}: {
  tournaments: Tournament[] | undefined;
}) {
  if (tournaments === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading tournaments</CardTitle>
          <CardDescription>
            Fetching public events available to players.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-12" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (tournaments.length === 0) {
    return (
      <Empty className="min-h-80 border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <UserRound aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No upcoming tournaments</EmptyTitle>
          <EmptyDescription>
            Public tournaments will appear here once an organizer publishes
            future events.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Public tournament schedule</CardTitle>
        <CardDescription>
          Upcoming events published by tournament organizers.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>Tournament</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Start date</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tournaments.map((tournament) => (
              <TournamentRow key={tournament._id} tournament={tournament} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TournamentRow({ tournament }: { tournament: Tournament }) {
  return (
    <TableRow>
      <TableCell>
        <p className="font-medium text-foreground">{tournament.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {tournament.isTestEvent ? "Test event" : "Public event"}
        </p>
      </TableCell>
      <TableCell className="capitalize">{tournament.format}</TableCell>
      <TableCell>
        {dateFormatter.format(new Date(tournament.startDate))}
      </TableCell>
      <TableCell>{tournament.playerCapacity}</TableCell>
      <TableCell className="capitalize">{tournament.status}</TableCell>
      <TableCell className="text-right">
        <Button asChild type="button" variant="outline">
          <Link to="/tournaments/$tournamentId" params={{ tournamentId: tournament._id }}>
            View &amp; register
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}
