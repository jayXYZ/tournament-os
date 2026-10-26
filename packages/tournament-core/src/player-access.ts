import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";

import { api } from "@paper-pairings/backend/convex/_generated/api";

import { useViewerAuthGate } from "./auth-readiness";
import type { AppAuthSnapshot } from "./auth-readiness";
import { useMyRegistration } from "./hooks";

export type PlayerTournamentEvent = NonNullable<
  FunctionReturnType<typeof api.tournaments.lifecycle.getPublicTournament>
>;
export type PlayerRegistration = NonNullable<
  FunctionReturnType<typeof api.tournaments.registrations.getMyRegistration>
>;

export type PlayerTournamentAccess =
  // Something is still unresolved. `event` is null while the event lookup is
  // in flight, or while a null answer waits on the auth gate — show a
  // spinner; once the event is known the remaining wait is for the gate and
  // the registration answer — show content skeletons.
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
// code resolves the event, then a viewer the auth gate lets through with a
// confirmed registration reaches `ready`. Screens render their real content
// only in `ready` and give every other state its own shell.
export function usePlayerTournamentAccess(
  publicCode: string,
  appAuth: AppAuthSnapshot,
): PlayerTournamentAccess {
  const gate = useViewerAuthGate(appAuth);
  const event = useQuery(api.tournaments.lifecycle.getPublicTournament, {
    publicCode,
  });
  const registration = useMyRegistration(event?.tournament._id ?? null);

  // A resolved event never depends on Convex auth — getPublicTournament only
  // consults the viewer for non-public events — so a defined result renders
  // immediately. Only a `null` result is ambiguous: a private event resolves
  // null until Convex validates the viewer's token, so while the gate is
  // pending that null waits before notFound may claim it.
  if (event === undefined || (event === null && gate === "pending")) {
    return { state: "loading", event: null };
  }
  // Once the gate settles a null is final, even when it settled signedOut on
  // a refused token: the server answers null for a private event it sees no
  // identity on, exactly as it does for a provider-less visitor, so it cannot
  // be told apart from a code that does not exist — and the signedOut shell
  // needs the event it would offer sign-in for.
  if (event === null) {
    return { state: "notFound" };
  }
  if (gate === "pending") {
    return { state: "loading", event };
  }
  // Nobody signed in, or a provider user whose token Convex refused: the
  // registration query would stay on 'skip' for good, so offer sign-in.
  if (gate === "signedOut") {
    return { state: "signedOut", event };
  }
  // The gate is ready, so this undefined is the registration query in flight
  // — useMyRegistration never answers a false null through the token-lag
  // window, which the pending gate has already absorbed.
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
