import { useQuery } from "convex/react";

import { api } from "@paper-pairings/backend/convex/_generated/api";

import { useViewerAuthGate } from "./auth-readiness";
import type { AppAuthSnapshot } from "./auth-readiness";

export type JoinCodeResolution =
  | { state: "loading" }
  // Unknown, malformed, revoked, hidden, and pre-publication codes alike:
  // the server answers each one the same way, so the screen can't say which.
  | { state: "notFound" }
  // A provider user Convex could not verify, and the code opened nothing for
  // them: a private event they hold a row in resolves only for a verified
  // identity, so the null is not yet known to be a bad code. The screen
  // offers the gate's recovery (restart the handshake, or sign out).
  | { state: "unverified" }
  // The event the code opens, plus the invite code when it was one, which
  // the event lookup and registerSelf both need on a private event.
  | { state: "resolved"; publicCode: string; inviteCode?: string };

// Resolves the code from a /join/<code> link (CONTEXT.md "Join QR") through
// resolveJoinCode. A public code for a private event resolves only for
// viewers who could open its page, so, as in usePlayerTournamentAccess, a
// null answer waits on the viewer auth gate before it may read as not found:
// through the provider's own loading, Convex's token validation and its
// grace period, and — once the gate gives up on the identity — as
// `unverified` rather than a wrong code. A code that resolves does so for
// anyone and never waits on the gate.
export function useJoinCode(
  code: string,
  appAuth: AppAuthSnapshot,
): JoinCodeResolution {
  const gate = useViewerAuthGate(appAuth);
  const resolved = useQuery(api.tournaments.invites.resolveJoinCode, {
    code,
  });
  if (
    appAuth.loading ||
    resolved === undefined ||
    (resolved === null && gate === "pending")
  ) {
    return { state: "loading" };
  }
  if (resolved === null) {
    return gate === "unverified"
      ? { state: "unverified" }
      : { state: "notFound" };
  }
  return { state: "resolved", ...resolved };
}
