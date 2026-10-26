# User-facing errors

Production Convex deployments redact the message of a plain `Error` thrown
by a function to `"Server Error"` before it reaches the client; only the
`data` of a `ConvexError` is forwarded
([Convex docs: application errors](https://docs.convex.dev/functions/error-handling/application-errors)).
Dev deployments pass the message through, so a refusal that reads fine
locally can reach a real user as a generic failure. This document is the
contract both sides follow so that does not happen.

## Backend: `userError` vs. plain `Error`

`packages/backend/convex/model/errors.ts` exports `userError(message)`,
which throws a `UserError` — a `ConvexError` whose payload is the bare
string. Throw it for anything written for the person using the app and
reachable from a public function they can trigger through the UI:

- capacity, duplicates, "already X", "cannot be X in its current state";
- lifecycle refusals (not open for registration, locked after publication,
  cancelled, no longer running);
- checkout and payment state;
- form validation (names, dates, capacities, phase config, ticket windows,
  decklists, result notes, timer adjustments);
- progression verdicts and manual-pairing refusals;
- the caller's own registration state.

Throw a plain `Error` for everything that is not written for the user, so it
stays generic in production on purpose:

- authorization ("Unauthorized", "Not authenticated", "Only an organizer
  can …", "You are not part of this match");
- "… not found" for ids a client should never hold;
- cross-ownership mismatches a well-behaved client never sends;
- invariants, `satisfies never` asserts, engine internals, Stripe and env
  configuration, pagination and batching guards.

When a function checks authorization and state, settle authorization first
and as a plain `Error`, so an outsider never reads state from the refusal
that follows (see `requireMatchParticipant` in `tournaments/player.ts`).

The payload is a bare string so `error.message` is the same text in dev and
in specs, and `rejects.toThrow("…")` assertions keep working. Only the
payload crosses the wire, so **no other code in the backend may throw a
`ConvexError` with a string payload**: the client treats every such payload
as a refusal to display. Structured payloads — the rate limiter's
`{ kind: "RateLimited", … }`, the pagination handshake — are objects. On the
server and in specs, `instanceof UserError` tells a refusal from any other
`ConvexError`; `specHelpers.ts` has `rejection()` for checking one run of a
refused call for both class and payload.

## Clients: `mutationErrorMessage` and `userErrorMessage`

`packages/tournament-core/src/mutation-error.ts` is the single place a
thrown error becomes text for a user.

- `mutationErrorMessage(error, fallback)` — for mutations and actions.
  Rate-limited rejections become a retry-later notice; a string
  `ConvexError` payload is shown as written; any other failure the Convex
  client rebuilt from a server response (its message starts with
  `[CONVEX `) and any structured `ConvexError` payload become `fallback`.
  Only an `Error` the client threw itself — form validation ahead of the
  call — keeps its own message. Every web mutation toast routes through it
  (`useBusyAction` or directly); native mutation flows do the same.
- `userErrorMessage(error)` — the string payload of a refusal, or `null`.
  The web router's default error component uses it so a refusal thrown by a
  query (for example `requireRegisteredPlayer` once a registration is
  cancelled under an open player view) renders as written rather than as
  "Something went wrong".

A query should throw `userError` only when the refusal is a legitimate state
the UI can land in; a guard the UI already enforces client-side (the fee
preview validates with the same shared function before subscribing) stays a
plain `Error`.

## Related

- `docs/rate-limiting.md` — the rate limiter's structured payload and how the
  same helper renders it.
- `docs/error-monitoring.md` — Sentry capture; refusals that reach the web
  error component are still captured, since a view that let a user reach
  one is worth knowing about.
