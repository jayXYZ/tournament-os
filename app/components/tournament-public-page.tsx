"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  LogIn,
  SearchX,
  Swords,
  Users,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { Toaster } from "@/components/ui/sonner";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

type Tournament = Doc<"tournaments">;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const statusBadges: Record<
  Tournament["status"],
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  private: { label: "Private", variant: "outline" },
  public: { label: "Open for registration", variant: "secondary" },
  in_progress: { label: "In progress", variant: "default" },
  completed: { label: "Completed", variant: "outline" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

export function TournamentPublicPage({
  tournamentId,
}: {
  tournamentId: string;
}) {
  const event = useQuery(api.tournaments.lifecycle.getPublicTournament, {
    tournamentId,
  });

  return (
    <main className="min-h-svh bg-background text-foreground">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex min-h-16 max-w-4xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Swords className="size-5" aria-hidden="true" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">
                Tournament OS
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Tournament details
              </p>
            </div>
          </div>
          <Button asChild type="button" variant="ghost">
            <Link href="/">
              <ArrowLeft data-icon="inline-start" />
              All tournaments
            </Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto grid max-w-4xl gap-6 px-4 py-8 sm:px-6 lg:px-8">
        {event === undefined ? (
          <LoadingCard />
        ) : event === null ? (
          <NotFound />
        ) : (
          <TournamentDetails
            tournament={event.tournament}
            organizationName={event.organizationName}
            registeredCount={event.registeredCount}
          />
        )}
      </section>
      <Toaster />
    </main>
  );
}

function LoadingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Loading tournament</CardTitle>
        <CardDescription>Fetching event details.</CardDescription>
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
        <Link href="/">Browse upcoming tournaments</Link>
      </Button>
    </Empty>
  );
}

function TournamentDetails({
  tournament,
  organizationName,
  registeredCount,
}: {
  tournament: Tournament;
  organizationName: string | null;
  registeredCount: number;
}) {
  const badge = statusBadges[tournament.status];
  const spotsLeft = Math.max(tournament.playerCapacity - registeredCount, 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-2xl">{tournament.name}</CardTitle>
          <Badge variant={badge.variant}>{badge.label}</Badge>
        </div>
        <CardDescription>
          {tournament.isTestEvent ? "Test event" : "Public event"}
          {organizationName ? ` hosted by ${organizationName}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <DetailLine
            icon={CalendarDays}
            label="Starts"
            value={dateFormatter.format(new Date(tournament.startDate))}
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
      </CardContent>
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          Pairings and standings will be available here once the event begins.
        </p>
      </CardFooter>
    </Card>
  );
}

function DetailLine({
  icon: Icon,
  label,
  value,
  capitalize = false,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string;
  capitalize?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="text-muted-foreground">{label}:</span>
      <span className={capitalize ? "font-medium capitalize" : "font-medium"}>
        {value}
      </span>
    </div>
  );
}

function RegistrationPanel({
  tournament,
  spotsLeft,
}: {
  tournament: Tournament;
  spotsLeft: number;
}) {
  const { user, loading, refreshAuth } = useAuth();
  const registration = useQuery(
    api.tournaments.registrations.getMyRegistration,
    user ? { tournamentId: tournament._id } : "skip",
  );
  const registerSelf = useMutation(api.tournaments.registrations.registerSelf);
  const cancelRegistration = useMutation(
    api.tournaments.registrations.cancelMyRegistration,
  );
  const [pending, setPending] = useState(false);

  const runAction = async (
    action: () => Promise<unknown>,
    successMessage: string,
  ) => {
    setPending(true);
    try {
      await action();
      toast.success(successMessage);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Something went wrong",
      );
    } finally {
      setPending(false);
    }
  };

  if (loading) {
    return (
      <Button type="button" variant="outline" disabled className="w-fit">
        <Spinner />
        Checking your registration
      </Button>
    );
  }

  if (!user) {
    if (tournament.status !== "public") {
      return (
        <p className="text-sm text-muted-foreground">
          Registration is closed for this event.
        </p>
      );
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
          {spotsLeft === 1 ? "1 spot left" : `${spotsLeft} spots left`}
        </p>
      </div>
    );
  }

  if (registration === undefined) {
    return (
      <Button type="button" variant="outline" disabled className="w-fit">
        <Spinner />
        Checking your registration
      </Button>
    );
  }

  if (registration && registration.status === "active") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge>You&apos;re registered</Badge>
        {tournament.status === "public" ? (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              void runAction(
                () =>
                  cancelRegistration({ tournamentId: tournament._id }),
                "Your registration has been cancelled.",
              )
            }
          >
            {pending ? <Spinner /> : null}
            Cancel registration
          </Button>
        ) : tournament.status === "in_progress" ? (
          <Button asChild type="button">
            <Link href={`/tournaments/${tournament._id}/play`}>
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
    );
  }

  if (tournament.status !== "public") {
    return (
      <p className="text-sm text-muted-foreground">
        Registration is closed for this event.
      </p>
    );
  }

  if (spotsLeft === 0) {
    return (
      <Button type="button" variant="outline" disabled className="w-fit">
        Tournament is full
      </Button>
    );
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
        {spotsLeft === 1 ? "1 spot left" : `${spotsLeft} spots left`}
      </p>
    </div>
  );
}
