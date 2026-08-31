import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "@paper-pairings/backend/convex/_generated/api";

import { useConvexAuthReadiness } from "./auth-readiness";
import { useMyRegistration } from "./hooks";

export type PlayerTournamentEvent = NonNullable<
  FunctionReturnType<typeof api.tournaments.lifecycle.getPublicTournament>
>;
export type PlayerRegistration = NonNullable<
  FunctionReturnType<typeof api.tournaments.registrations.getMyRegistration>
>;

// The identity signal each app supplies from its own auth provider — Clerk
// web on /play and /decklist, Clerk Expo on the native tournament screen.
// Only nullness is consulted; `loading` is the provider still resolving.
export type AppAuthSnapshot = {
  user: object | null;
  loading: boolean;
};

export type PlayerTournamentAccess =
  // Something is still unresolved. `event` is null while the event lookup
  // (or auth) is in flight — show a spinner; once the event is known the
  // remaining wait is for the registration answer — show content skeletons.
  | { state: "loading"; event: PlayerTournamentEvent | null }
  | { state: "notFound" }
  | { state: "signedOut"; event: PlayerTournamentEvent }
  | { state: "notRegistered"; event: PlayerTournamentEvent }
  | {
      state: "ready";
      event: PlayerTournamentEvent;
      registration: PlayerRegistration;
    };

// The one copy of the access ladder shared by every player surface: public
// code resolves the event, then a signed-in viewer with a confirmed
// registration reaches `ready`. Screens render their real content only in
// `ready` and give every other state its own shell.
export function usePlayerTournamentAccess(
  publicCode: string,
  appAuth: AppAuthSnapshot,
): PlayerTournamentAccess {
  const { user, loading } = appAuth;
  const convexAuth = useConvexAuthReadiness();
  const event = useQuery(api.tournaments.lifecycle.getPublicTournament, {
    publicCode,
  });
  const registration = useMyRegistration(event?.tournament._id ?? null);

  // A resolved event never depends on Convex auth — getPublicTournament only
  // consults the viewer for non-public events — so a defined result renders
  // immediately. Only a `null` result for a signed-in viewer is ambiguous: a
  // private event resolves null until Convex auth catches up with the
  // provider, so that one case waits for auth before notFound may claim it.
  if (
    loading ||
    event === undefined ||
    (event === null && user !== null && convexAuth === "pending")
  ) {
    return { state: "loading", event: null };
  }
  if (event === null) {
    return { state: "notFound" };
  }
  if (!user) {
    return { state: "signedOut", event };
  }
  // useMyRegistration holds `undefined` (never a false null) through the
  // Convex token-lag window, so this loading state — not notRegistered —
  // absorbs it.
  if (registration === undefined) {
    return { state: "loading", event };
  }
  // getMyRegistration returns any registration row — including cancelled
  // ones — while the player queries reject entries that are not confirmed,
  // so gate on entryStatus to match the server's requireRegisteredPlayer.
  if (registration === null || registration.entryStatus !== "confirmed") {
    return { state: "notRegistered", event };
  }
  return { state: "ready", event, registration };
}
