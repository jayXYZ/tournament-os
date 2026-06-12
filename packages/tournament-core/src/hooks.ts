import { useMutation, useQuery } from "convex/react";

import { api } from "@tournament-os/backend/convex/_generated/api";
import type { Id } from "@tournament-os/backend/convex/_generated/dataModel";

// Each app provides its own ConvexProviderWithAuth; these hooks only assume a
// Convex client is in context. Pass `null` while the tournament id is unknown
// (e.g. before the route param resolves) to skip the subscription.

export function useMyCurrentMatch(tournamentId: Id<"tournaments"> | null) {
  return useQuery(
    api.tournaments.player.getMyCurrentMatch,
    tournamentId ? { tournamentId } : "skip",
  );
}

export function useMyMatchHistory(tournamentId: Id<"tournaments"> | null) {
  return useQuery(
    api.tournaments.player.getMyMatchHistory,
    tournamentId ? { tournamentId } : "skip",
  );
}

export function useLatestStandings(tournamentId: Id<"tournaments"> | null) {
  return useQuery(
    api.tournaments.player.getLatestStandings,
    tournamentId ? { tournamentId } : "skip",
  );
}

export function useReportResult() {
  return useMutation(api.tournaments.player.reportMyMatchResult);
}

export function useConfirmResult() {
  return useMutation(api.tournaments.player.confirmMatchResult);
}

export function useDropSelf() {
  return useMutation(api.tournaments.player.dropSelf);
}
