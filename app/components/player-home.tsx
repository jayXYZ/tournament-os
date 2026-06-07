"use client";

import Link from "next/link";
import { useAuth } from "@workos-inc/authkit-nextjs/components";
import { useQuery } from "convex/react";
import {
  CalendarDays,
  LogIn,
  ShieldCheck,
  Sparkles,
  Swords,
  UserRound,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

type Tournament = Doc<"tournaments">;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function PlayerHome() {
  const { user, loading, refreshAuth, signOut } = useAuth();
  const tournaments = useQuery(api.tournaments.listUpcomingPublic);

  return (
    <main className="min-h-svh bg-stone-100 text-stone-950">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-md bg-stone-950 text-emerald-200">
              <Swords className="size-5" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">Tournament OS</p>
              <p className="mt-1 text-xs text-stone-500">Player tournament finder</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button asChild type="button" variant="outline">
              <Link href="/admin">
                <ShieldCheck className="size-4" />
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
        <div className="flex flex-col justify-between gap-5 border-b border-stone-200 pb-6 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-700">
              Player view
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-normal sm:text-4xl">
              Upcoming tournaments
            </h1>
          </div>
          <div className="grid gap-2 text-sm text-stone-600 sm:grid-cols-2 md:min-w-80">
            <StatusLine icon={CalendarDays} label="Showing public future events" />
            <StatusLine icon={Users} label="Registration actions coming next" />
          </div>
        </div>

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
      <span className="flex size-8 items-center justify-center rounded-md border border-stone-200">
        <span className="size-4 animate-spin rounded-full border-2 border-stone-500 border-t-transparent" />
      </span>
    );
  }

  if (email) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden max-w-48 truncate text-sm text-stone-600 lg:inline">
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
        <LogIn className="size-4" />
        Sign in
      </Button>
      <Button asChild type="button" className="hidden bg-stone-950 text-stone-50 hover:bg-stone-800 sm:inline-flex">
        <Link href="/sign-up">
          <Sparkles className="size-4" />
          Create account
        </Link>
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
      <Icon className="size-4 text-emerald-700" />
      <span>{label}</span>
    </div>
  );
}

function TournamentTable({
  tournaments,
}: {
  tournaments: Tournament[] | undefined;
}) {
  if (tournaments === undefined) {
    return (
      <div className="overflow-hidden rounded-md border border-stone-200 bg-white">
        <div className="grid gap-3 p-4">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-12 animate-pulse rounded-md bg-stone-100"
            />
          ))}
        </div>
      </div>
    );
  }

  if (tournaments.length === 0) {
    return (
      <section className="grid min-h-80 place-items-center rounded-md border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
        <div className="max-w-md">
          <UserRound className="mx-auto size-8 text-emerald-700" />
          <h2 className="mt-4 text-xl font-semibold">No upcoming tournaments</h2>
          <p className="mt-2 text-sm leading-6 text-stone-500">
            Public tournaments will appear here once an organizer publishes
            future events.
          </p>
        </div>
      </section>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-stone-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-[0.12em] text-stone-500">
            <tr>
              <th className="px-4 py-3 font-medium">Tournament</th>
              <th className="px-4 py-3 font-medium">Format</th>
              <th className="px-4 py-3 font-medium">Start date</th>
              <th className="px-4 py-3 font-medium">Capacity</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {tournaments.map((tournament) => (
              <TournamentRow key={tournament._id} tournament={tournament} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TournamentRow({ tournament }: { tournament: Tournament }) {
  return (
    <tr className="border-t border-stone-100">
      <td className="px-4 py-4">
        <p className="font-medium text-stone-950">{tournament.name}</p>
        <p className="mt-1 text-xs text-stone-500">
          {tournament.isTestEvent ? "Test event" : "Public event"}
        </p>
      </td>
      <td className="px-4 py-4 capitalize text-stone-700">{tournament.format}</td>
      <td className="px-4 py-4 text-stone-700">
        {dateFormatter.format(new Date(tournament.startDate))}
      </td>
      <td className="px-4 py-4 text-stone-700">{tournament.playerCapacity}</td>
      <td className="px-4 py-4">
        <span className="inline-flex rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium capitalize text-emerald-800">
          {tournament.status}
        </span>
      </td>
      <td className="px-4 py-4 text-right">
        <Button type="button" variant="outline" disabled>
          Registration soon
        </Button>
      </td>
    </tr>
  );
}
