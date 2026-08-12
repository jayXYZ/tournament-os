import { useMutation, useQuery } from "convex/react";

import { api } from "@tournament-os/backend/convex/_generated/api";
import type { Id } from "@tournament-os/backend/convex/_generated/dataModel";

import { useAuthedQueryArgs } from "./auth-readiness";

// Each app provides its own ConvexProviderWithAuth; these hooks only assume a
// Convex client is in context. Pass `null` while the tournament id is unknown
// (e.g. before the route param resolves) to skip the subscription.
//
// Every query here resolves the viewer server-side, so all of them route
// through useAuthedQueryArgs (see auth-readiness.ts): they stay skipped —
// `undefined`, the loading state — until Convex has validated the token, and
// never run unauthenticated to return a false "not registered" / "no data".

export function useMyCurrentMatch(tournamentId: Id<"tournaments"> | null) {
  return useQuery(
    api.tournaments.player.getMyCurrentMatch,
    useAuthedQueryArgs(tournamentId ? { tournamentId } : null),
  );
}

export function useMyMatchHistory(tournamentId: Id<"tournaments"> | null) {
  return useQuery(
    api.tournaments.player.getMyMatchHistory,
    useAuthedQueryArgs(tournamentId ? { tournamentId } : null),
  );
}

export function useLatestStandings(tournamentId: Id<"tournaments"> | null) {
  return useQuery(
    api.tournaments.player.getLatestStandings,
    useAuthedQueryArgs(tournamentId ? { tournamentId } : null),
  );
}

// A `null` result always means the server really found no registration row —
// during the token-lag window callers see `undefined` (loading) instead, so
// no page can misread the window as "not registered".
export function useMyRegistration(tournamentId: Id<"tournaments"> | null) {
  return useQuery(
    api.tournaments.registrations.getMyRegistration,
    useAuthedQueryArgs(tournamentId ? { tournamentId } : null),
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
    useAuthedQueryArgs(tournamentId ? { tournamentId } : null),
  );
}

export function useReportResult() {
  return useMutation(api.tournaments.player.reportMyMatchResult);
}

export function useDropSelf() {
  return useMutation(api.tournaments.player.dropSelf);
}
