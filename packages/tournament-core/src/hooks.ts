import { useMutation, useQuery } from "convex/react";

import { api } from "@paper-pairings/backend/convex/_generated/api";
import type { Id } from "@paper-pairings/backend/convex/_generated/dataModel";

import { useAuthedQueryArgs } from "./auth-readiness";
import { useStableQuery } from "./use-stable-query";

// Each app provides its own ConvexProviderWithAuth; these hooks only assume a
// Convex client is in context. Pass `null` while the tournament id is unknown
// (e.g. before the route param resolves) to skip the subscription.
//
// Every query here that resolves the viewer server-side (all but
// useFeePreview) routes through useAuthedQueryArgs (see auth-readiness.ts):
// they stay skipped — `undefined`, the loading state — until Convex has
// validated the token, and never run unauthenticated to return a false
// "not registered" / "no data".

function useTournamentQueryArgs(tournamentId: Id<"tournaments"> | null) {
  return useAuthedQueryArgs(tournamentId ? { tournamentId } : null);
}

export function useMyCurrentMatch(tournamentId: Id<"tournaments"> | null) {
  return useQuery(
    api.tournaments.player.getMyCurrentMatch,
    useTournamentQueryArgs(tournamentId),
  );
}

export function useMyMatchHistory(tournamentId: Id<"tournaments"> | null) {
  return useQuery(
    api.tournaments.player.getMyMatchHistory,
    useTournamentQueryArgs(tournamentId),
  );
}

export function useLatestStandings(tournamentId: Id<"tournaments"> | null) {
  return useQuery(
    api.tournaments.player.getLatestStandings,
    useTournamentQueryArgs(tournamentId),
  );
}

// A `null` result always means the server really found no registration row —
// during the token-lag window callers see `undefined` (loading) instead, so
// no page can misread the window as "not registered".
export function useMyRegistration(tournamentId: Id<"tournaments"> | null) {
  return useQuery(
    api.tournaments.registrations.getMyRegistration,
    useTournamentQueryArgs(tournamentId),
  );
}

export function useMyTournaments() {
  return useQuery(
    api.tournaments.registrations.listMyTournaments,
    useAuthedQueryArgs({}),
  );
}

export function useMyDecklist(tournamentId: Id<"tournaments"> | null) {
  return useQuery(
    api.tournaments.decklists.getMyDecklist,
    useTournamentQueryArgs(tournamentId),
  );
}

export function useReportResult() {
  return useMutation(api.tournaments.player.reportMyMatchResult);
}

export function useDropSelf() {
  return useMutation(api.tournaments.player.dropSelf);
}

export function useRegisterSelf() {
  return useMutation(api.tournaments.registrations.registerSelf);
}

export function useCancelMyRegistration() {
  return useMutation(api.tournaments.registrations.cancelMyRegistration);
}

// The viewer's latest entry order on a paid event. `now` is the app's
// client clock (useClientClock, rounded up: the cancel outcome reads as a
// promise), and the result is held across its ticks. Pass a null
// tournament id on a free event to skip it.
export function useMyEntryOrder(
  tournamentId: Id<"tournaments"> | null,
  now: number,
) {
  return useStableQuery(
    api.payments.queries.getMyEntryOrder,
    useAuthedQueryArgs(tournamentId ? { tournamentId, now } : null),
  );
}

// What a player pays for an entry fee, fees included. Public fee policy, so
// no auth gate. Pass null on a free event to skip it.
export function useFeePreview(entryFeeCents: number | null) {
  return useQuery(
    api.payments.queries.getFeePreview,
    entryFeeCents ? { entryFeeCents } : "skip",
  );
}
