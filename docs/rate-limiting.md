# Rate limiting and abuse controls

Application-layer rate limiting runs on the official Convex component
(`@convex-dev/rate-limiter`, mounted in `convex/convex.config.ts`). Every
limit — names, budgets, and the reasoning behind each — lives in one place:
`packages/backend/convex/rateLimits.ts`. Mutations opt in by calling
`enforceRateLimit(ctx, "<name>")` as the first line of their handler.

## What is limited

Per-identity token buckets cover the self-serve mutation surface: everything
an authenticated account can call without holding a privileged role, plus the
membership-gated mutations that create rows or storage. Membership is not
treated as a scarcity gate because any account can mint its own organization.

| Bucket                                | Mutations                                                                |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `upsertMe`                            | `users.upsertMe` (runs on every sign-in)                                 |
| `updateProfileSettings`               | `users.updateMyProfileSettings`                                          |
| `registerSelf` / `cancelRegistration` | registration churn pair                                                  |
| `dropSelf`                            | `tournaments.player.dropSelf`                                            |
| `reportResult`                        | `tournaments.player.reportMyMatchResult`                                 |
| `submitDecklist`                      | `tournaments.decklists.submitMyDecklist`                                 |
| `createOrganization`                  | `organizations.createOrganizerOrganization` (strictest: 3 burst, 12/day) |
| `inviteMember`                        | `inviteMember` + `revokeInvitation` (future email budget)                |
| `profileImageUpload`                  | upload-URL minting + image swap (storage abuse)                          |
| `createTournament`                    | `createTournament`, `createTournamentWithPhases`, `createTestTournament` |
| `seedTestPlayers`                     | guest participant/registration row growth                                |
| `stripeOnboarding`                    | Stripe Connect onboarding-link minting (strict: 8 burst, 24/day)         |
| `refreshStripeStatus`                 | manual Stripe account-status refresh                                     |
| `createCheckout`                      | Stripe Checkout session creation                                         |

The three Stripe buckets are debited inside `internalMutation`s fronted by
public **actions** (`payments/connect.ts`, `payments/checkout.ts` explain
why), a deliberate exception to the "first line of the mutation handler"
pattern above.

Keys are the identity's `tokenIdentifier`, so one abusive account cannot
starve anyone else, and the key exists before the `users` row does. The
numbers are deliberately generous: they are sized so no human workflow —
including repeated browser-E2E runs, which reuse one persistent
dev-deployment user — comes near them. They stop scripted write
amplification (audit-log growth, storage minting, registration churn), not
legitimate play. Tune them in `rateLimits.ts`; nothing else needs to change.

## What is deliberately not limited

- **Organizer event-day operations** (pairing, timers, result entry, round
  completion, roster management): they run in bursts on event day and their
  blast radius is confined to the organizer's own events.
- **Invite-link management** (`regenerateInviteLink`, `disableInviteLink`):
  organizer-gated and bounded at one `tournamentInvites` row per tournament
  (regenerating rewrites the same row), so there is no write amplification
  to meter.
- **Queries.** Convex queries cannot write, so they cannot debit a bucket.
  The query surface is protected structurally instead: every public query
  reads through bounded `take()`s, `clampPageSize` on client-supplied page
  sizes, explicit read budgets (`PROFILE_RESULTS_RAW_READ_BUDGET`), and
  viewer-based visibility gates. There are no unbounded `.collect()` calls
  in deployed backend code.
- **Failed mutations.** Convex rolls back all writes — including the bucket
  debit — when a mutation throws, so buckets meter successful calls only.
  Hammering a mutation that always fails is compute abuse, which
  platform-level protection covers.
- **Anonymous / per-IP traffic.** Convex functions never see a caller IP;
  volumetric and unauthenticated abuse is the platform edge's job.

## Behavior when a limit trips

`enforceRateLimit` throws the component's `ConvexError` with
`data: { kind: "RateLimited", name, retryAfter }`. `ConvexError` data
survives production error redaction, so clients can branch on it. Both
clients do so through one helper: `mutationErrorMessage(error, fallback)`
in `@paper-pairings/core` turns a rate-limited rejection into a retry-later
message sized from `retryAfter` ("try again in about 2 minutes") and
returns the error's own message otherwise. Every web mutation-error toast
routes through it (via `useBusyAction` or directly); native mutation flows
adopt it as they land. The helper reimplements the
`isRateLimitError` check against the same payload shape rather than
importing `@convex-dev/rate-limiter`, so its `instanceof ConvexError` test
resolves through each app's own `convex` instance instead of a second copy
pnpm may give the component package.

## Testing

`convex/rateLimits.convex.spec.ts` covers exhaustion, per-identity
isolation, refill over time, and the rollback-on-failure semantics. Suites
construct their harness through `createConvexTest()` in
`convex/specHelpers.runtime.ts`, which registers the component alongside the
app schema — a suite built any other way fails at its first rate-limited
mutation. That helper performs runtime imports, so it must never be bundled
as a deployment entry point; the extra dot in its filename is what excludes
it (the Convex CLI skips entry-point basenames containing more than one
dot, the same rule that excludes the spec files themselves).
