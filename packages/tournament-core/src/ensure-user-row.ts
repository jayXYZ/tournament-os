import { useMutation } from "convex/react";
import { useCallback, useEffect, useState } from "react";

import { api } from "@paper-pairings/backend/convex/_generated/api";

import { useConvexAuthReadiness } from "./auth-readiness";
import { mutationErrorMessage } from "./mutation-error";

// The fallback shown when the sign-in rejects for a reason not written for
// the user (a dropped connection, a redacted server error).
export const ACCOUNT_SETUP_FAILED_MESSAGE =
  "Something went wrong while setting up your player account. Check your connection and try again.";

// The app's sign-in: runs the backend's upsertMe once Convex has verified
// the viewer, and again after every later sign-in. Mounted once per app at
// the root (web's EnsureUserRowProvider, native's root layout), so opening
// the app signed in is enough for everything the sign-in triggers:
//
// - a Clerk session can exist before its users row does (first visit), so
//   api.users.me stays null until something creates the row — this does,
//   and Convex reactivity re-renders any subscribed query once it lands;
// - name and avatar are refreshed from the identity on later visits;
// - the Claim (CONTEXT.md "Claim") hands the account every Guest entry an
//   organizer enrolled under its email. Player pages only query, so without
//   this the enrolled player opening their event page would read as not
//   registered until some mutation happened to run the sign-in.
//
// It waits for the viewer auth readiness (auth-readiness.ts): a mutation
// fired during the token-lag window would run unauthenticated and be
// refused. `failure` holds the message when the upsert rejects — the
// backend's own refusal when it is one written for the user (an account
// with no name), else ACCOUNT_SETUP_FAILED_MESSAGE — so a surface whose UI
// blocks on the row can show it instead of loading forever; `retry` clears
// it and re-runs the upsert.
export function useEnsureUserRow(): {
  failure: string | null;
  retry: () => void;
} {
  const readiness = useConvexAuthReadiness();
  const upsertMe = useMutation(api.users.upsertMe);
  const [failure, setFailure] = useState<string | null>(null);

  const retry = useCallback(() => {
    setFailure(null);
    upsertMe().catch((error: unknown) =>
      setFailure(mutationErrorMessage(error, ACCOUNT_SETUP_FAILED_MESSAGE)),
    );
  }, [upsertMe]);

  useEffect(() => {
    if (readiness !== "ready") {
      // Signed out, or not yet verified: nothing to run, and a failure from
      // an earlier session does not carry into the next.
      setFailure(null);
      return;
    }
    retry();
  }, [readiness, retry]);

  return { failure, retry };
}
