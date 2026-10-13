import { useQuery } from "convex/react";

import { api } from "@paper-pairings/backend/convex/_generated/api";

import { useConvexAuthReadiness } from "./auth-readiness";
import type { AppAuthSnapshot } from "./player-access";

export type JoinCodeResolution =
  | { state: "loading" }
  // Unknown, malformed, revoked, hidden, and pre-publication codes alike:
  // the server answers each one the same way, so the screen can't say which.
  | { state: "notFound" }
  // The event the code opens, plus the invite code when it was one, which
  // the event lookup and registerSelf both need on a private event.
  | { state: "resolved"; publicCode: string; inviteCode?: string };

// Resolves the code from a /join/<code> link (CONTEXT.md "Join QR") through
// resolveJoinCode. A public code for a private event resolves only for
// viewers who could open its page, so, as in usePlayerTournamentAccess, a
// null answer for a signed-in viewer waits for Convex auth to settle before
// it may read as not found.
export function useJoinCode(
  code: string,
  appAuth: AppAuthSnapshot,
): JoinCodeResolution {
  const convexAuth = useConvexAuthReadiness();
  const resolved = useQuery(api.tournaments.invites.resolveJoinCode, {
    code,
  });
  if (
    appAuth.loading ||
    resolved === undefined ||
    (resolved === null && appAuth.user !== null && convexAuth === "pending")
  ) {
    return { state: "loading" };
  }
  if (resolved === null) {
    return { state: "notFound" };
  }
  return { state: "resolved", ...resolved };
}
