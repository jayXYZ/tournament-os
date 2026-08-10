# Tournament OS roadmap

This roadmap was audited against the current implementation and reordered to
build reusable domain foundations before client polish or provider-specific
integrations. A checked child under an open parent records foundation that is
already in place; the parent remains open until all of its acceptance criteria
are satisfied.

## 0. Delivery guardrails

These are cross-cutting foundations and should land alongside the first domain
changes rather than waiting for a final production milestone.

- [x] Add browser E2E coverage for the organizer happy path: create → publish → register → pair → report → complete
- [ ] Extend the E2E path with correction, drop, no-show, and rewind scenarios as those workflows land
  - [x] Cover active-round result correction with its audit-trail entry, a
        pairing rewind that reopens the previous round, and an organizer drop
        that produces a bye round and a "Dropped" standings row
  - [ ] Cover no-show and forfeit scenarios once the organizer actions land
        (blocked on section 1's adjudication work)
- [ ] Add error monitoring for the web app, native app, and Convex functions
  - [x] Wire Sentry into the web app (client, SSR entry, server-function
        middleware, router error component) behind `VITE_SENTRY_DSN`, with
        source-map upload activating only when `SENTRY_AUTH_TOKEN` is set
  - [x] Wire Sentry into the native app (root-layout init, `Sentry.wrap`,
        Sentry Metro config, Expo config plugin) behind
        `EXPO_PUBLIC_SENTRY_DSN`
  - [ ] Run `scripts/setup-error-monitoring.sh` to create the Sentry
        projects and capture DSNs/credentials (human-only account setup; see
        `docs/error-monitoring.md`)
  - [ ] Enable Convex exception reporting to Sentry in the deployment
        dashboard — blocked on the team being on Convex Pro (the integration
        is Pro-only; no code side exists)
- [ ] Add rate limiting and abuse controls to public queries and mutations
  - [x] Add per-identity token buckets on every self-serve mutation and on
        row/storage-creating organizer mutations via the
        `@convex-dev/rate-limiter` component, with all budgets and their
        rationale centralized in `convex/rateLimits.ts` (see
        `docs/rate-limiting.md`); covered by `rateLimits.convex.spec.ts`
  - [x] Verify the public query surface stays structurally bounded — queries
        cannot write, so they cannot be metered; protection is bounded
        `take()`s, `clampPageSize`, read budgets, viewer gating, and zero
        unbounded `.collect()` calls in deployed code
  - [x] Surface RateLimited rejections as a friendly retry-later message
        instead of the raw ConvexError toast: `mutationErrorMessage` in
        `@tournament-os/core` sizes the message from `retryAfter` and every
        web mutation-error toast routes through it; native issues no
        mutations yet, so its result-reporting flows (section 8) adopt the
        same helper as they land
- [ ] Establish production deployment checks for Convex and the web app
  - [ ] Fix the Vercel build boundary: `apps/web/vercel.json` runs
        `npx convex deploy` from `apps/web`, but the Convex project lives in
        `packages/backend` — run the deploy from the backend package, invoke
        the web build explicitly via `--cmd`, pass
        `--cmd-url-env-var-name VITE_CONVEX_URL`, and prefer pnpm over npx/npm
- [ ] Configure and verify the custom domain
- [ ] Address the oversized web settings chunk with route/component code splitting
- [ ] Finish the pnpm 11 settings migration
  - [ ] Move `node-linker=hoisted` from `.npmrc` into `pnpm-workspace.yaml` as
        `nodeLinker: hoisted` — pnpm 11 ignores the `.npmrc` setting, so the
        active install is isolated despite the documented Expo/Metro hoisting
        rationale
  - [ ] Delete the `ignoredBuiltDependencies`/`onlyBuiltDependencies` keys
        (removed in pnpm 11) and fold them into `allowBuilds`, adding the
        missing `sharp: false`
- [ ] Commit environment contracts
  - [ ] Add a `!**/.env.example` exception to `.gitignore` (the blanket `.env*`
        rule keeps `apps/native/.env.example` untracked) and commit native and
        web examples
  - [ ] Document required variables: web (`VITE_CONVEX_URL`,
        `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`), native (the two
        `EXPO_PUBLIC_*` vars), Convex deployment (`CLERK_JWT_ISSUER_DOMAIN`,
        `PROFILE_RESULTS_CURSOR_KEY`)
  - [ ] Add typed environment declarations via `defineApp({ env })` in a
        backend `convex.config.ts` and make `auth.config.ts`
        `satisfies AuthConfig` for deployment-time validation
- [ ] Expand CI beyond `pnpm test`: add lint, typecheck, `format:check`, and a
      native Expo dependency/export smoke check (the native package has no
      test script, so root tests silently skip it)
- [ ] Lint the backend: the Convex ESLint plugin is configured only in
      `apps/web`, whose config cannot reach `packages/backend/convex` — add a
      backend ESLint config and script
- [ ] Add a unified root check command covering tests, package typechecks,
      lint, and `format:check`; fix the 36 unformatted web files and give
      `packages/shared` and `packages/tournament-core` standalone
      `tsconfig.json` files and typecheck scripts
- [ ] Pin the toolchain: root `"packageManager": "pnpm@11.9.0"`, a Node
      version file/engines field, and CI/local alignment (CI runs Node 22,
      local development Node 26)
- [ ] Align duplicated workspace dependency versions: native installs Convex
      1.39.1 while web/backend use 1.42.0 even though Metro forces a Convex
      singleton; consider pnpm catalogs for convex, react, vite, vitest, and
      TypeScript
- [ ] Pin the patched `@clerk/expo` exactly (currently a caret range carrying
      a local Swift patch) and version-qualify its `patchedDependencies` entry
- [ ] Simplify `apps/native/metro.config.js`: Expo SDK 56 supplies
      `watchFolders` and `nodeModulesPaths` automatically; keep the singleton
      resolver until a native smoke test proves it unnecessary

## 1. Result and adjudication foundation

Build one result model and transition path before adding more result-entry
surfaces. It should support played results, corrections, draws, forfeits,
no-shows, and disqualifications without each workflow inventing its own rules.

- [ ] Add a match policy to each phase
  - [ ] Configure Best-of-X / match structure per phase
  - [ ] Derive valid result entry from the phase policy instead of hardcoding 0–2 game wins
  - [ ] Define whether draws are allowed for the phase type
- [ ] Replace the wins-only result shape with a normalized adjudication model
  - [ ] Track game wins, game losses, and game draws
  - [ ] Compute match-win and game-win percentages from match/game points so drawn games count (MTR Appendix C)
  - [ ] Exclude byes from a player's percentages where they feed opponents' tiebreakers
  - [ ] Break residual perfect ties with a per-player random value fixed for the tournament instead of registration time
  - [ ] Distinguish played results, intentional draws, concessions, forfeits, no-shows, byes, and DQs
  - [ ] Keep immutable result revisions and identify the current result
  - [x] Preserve the previous result in the organizer audit trail for active-round overrides
- [ ] Remove opponent result confirmation — the confirmed match status, mutation, and player UI; disputes resolve through organizer override
- [ ] Add organizer result corrections after a round or tournament completes
  - [x] Allow organizers to enter or override results during the active round
  - [x] Recompute standings when an active round is completed
  - [x] Rewind the latest untouched round and reopen the preceding round
  - [ ] Recompute standings snapshots from the corrected round forward while preserving pairings that actually occurred
  - [ ] Define correction behavior when a changed result would have altered a phase cutoff or playoff field
- [ ] Complete real-event drop and adjudication handling
  - [x] Allow organizer and player drops during an event
  - [x] Keep a dropped player's current pairing available so its result can still be reported
  - [ ] Record a match loss or other configured outcome for a mid-round drop
  - [ ] Add organizer no-show and forfeit actions
  - [ ] Replace bracket loser-revival with walkovers: the scheduled opponent receives a 2–0 bye when a bracket player leaves before their match; walkovers may chain; departed players keep the placement of the seat they reached (see ADR 0001)
  - [ ] Complete the organizer DQ workflow (MTR/IPG-aligned — see `CONTEXT.md`)
    - [ ] Remove DQ'd players from standings entirely so every lower-ranked player advances one place, deleting the mask-as-drop machinery this replaces
    - [ ] Keep a DQ'd player's completed matches on record and feeding former opponents' tiebreakers, with the tournament staying on their profile without a placement
    - [ ] Add an organizer-authorized DQ action and participation-state transition
    - [ ] Record each DQ as a typed, organizer-only audit event with the actor and affected player
    - [ ] Apply the DQ's match consequence: the disqualified player loses their current match (IPG 1.1)
- [ ] Add late entry after round 1
  - [ ] Configure the tournament/phase late-entry policy
  - [ ] Represent missed-round byes, losses, or point adjustments explicitly in history and standings
- [ ] Expand tournament-engine invariant tests
  - [x] Cover rematch avoidance and unavoidable-rematch behavior with deterministic cases
  - [x] Cover distinct byes, max-capacity Swiss standings, drops, cutoffs, and bracket rewinds
  - [ ] Add randomized/generative tests across field sizes, seeds, rounds, drops, and brackets

## 2. Phase structure and cuts

Cuts and brackets per the 2026-08-09 domain-modeling session (see `CONTEXT.md`
and `docs/adr/0001-bracket-walkover-to-scheduled-opponent.md`). Bracket
walkover behavior itself lands with the adjudication model in section 1.

- [ ] Decouple cuts from phase types
  - [ ] Allow a top-N or points-bar cut before any following phase type, defaulting to no cut between Swiss phases and a top-N cut into single elimination
  - [ ] Remove the special-cased top-8 cut in favor of an ordinary cut to 8
  - [ ] Warn in the UI when a points-bar cut feeds a single-elimination phase, since the bracket size becomes unpredictable
- [ ] Generalize single-elimination brackets
  - [ ] Support any entry size of at least 2: the bracket is the smallest power of two that fits the field, standard-seeded
  - [ ] Give the highest seeds first-round byes when the field is short instead of skipping the phase
  - [ ] Complete the tournament instead of playing a one-player phase
  - [ ] Generalize bracket round names (Round of 16, Quarterfinals, Semifinals, Finals)
- [ ] Allow single elimination as the first phase, seeded from the tournament's random seed
- [ ] Lower the 16-phase cap to a realistic bound (the largest real events need 5–6)

## 3. Player identity and admission

Guest enrollment, invitations, favorites, email, and payments need a player
identity that can exist without an authenticated account and can later be
claimed by one.

- [ ] Separate tournament player identity from authenticated users
  - [ ] Add a player/participant entity with an optional linked user
  - [ ] Store normalized contact email and organizer-provided display name
  - [ ] Point registrations at the participant identity
  - [ ] Define how a guest participant is claimed or merged after account creation
- [ ] Centralize registration and participation state transitions
  - [x] Keep entry status separate from competitive participation status
  - [x] Reserve pending, waitlisted, confirmed, cancelled, and rejected entry states
  - [x] Reserve active, dropped, eliminated, and disqualified participation states
  - [ ] Add write-side transitions and authorization for every supported state
  - [ ] Define capacity, decklist, payment, cancellation, and refund guards for each transition
- [ ] Add invite-only admission modes
  - [x] Support public, unlisted, and private tournament visibility
  - [ ] Add join-by-link/code invitations
  - [ ] Add organizer approval and rejection of pending registrations
  - [ ] Bar re-entry to a private event after organizer removal (launch-blocking): a cancelled registration must stop acting as a standing invitation once the player is rejected — needs the rejection flow's write side
  - [ ] Add waitlist promotion
- [ ] Enroll players as guests or by email without requiring an account
- [ ] Persist organizer favorite players across tournaments
  - [ ] Decide whether favorites are scoped to an organizer or the organization
  - [ ] Filter pairings, registrations, and standings by favorites

## 4. Event hierarchy and conventions

Model conventions and other umbrella events as first-class containers instead
of overloading a tournament or relying on naming conventions. Tournaments must
remain usable on their own and keep their own registration, phases, rounds,
results, and standings.

- [ ] Add an umbrella-event entity that can contain multiple tournaments
  - [ ] Support convention and generic umbrella-event types without allowing recursive nesting
  - [ ] Store the container's name, description, date range, timezone, visibility, and lifecycle
  - [ ] Allow a tournament to belong to zero or one umbrella event
  - [ ] Define cancellation, deletion, and archival behavior without silently changing completed child events
- [ ] Add convention-level event management
  - [ ] Create a child tournament from a convention and attach, detach, or move an existing tournament with permission checks
  - [ ] Share convention staff with child tournaments while allowing event-specific roles and overrides
  - [ ] Reuse convention venue and schedule defaults while allowing each child event to override them
  - [ ] Detect obvious scheduling conflicts when the same player registers for overlapping child events
- [ ] Add convention organizer and public surfaces
  - [ ] Show all child events with their format, registration state, schedule, capacity, and lifecycle status
  - [ ] Add convention-scoped navigation and an organizer overview across all child events
  - [ ] Add a public convention landing page with schedule and event discovery
  - [ ] Preserve direct tournament URLs and standalone discovery for child events

## 5. Judge operations and player conduct

Give judges a focused event-day workspace and model judge actions as durable,
auditable domain records. Operational table state must remain separate from a
match result so judge tooling cannot accidentally change standings.

- [ ] Add judge and head-judge roles with explicit permissions
  - [ ] Assign staff to one tournament, selected tournaments, or every child event in a convention
  - [ ] Separate access to live match operations, private notes, infraction history, and disqualification actions
- [ ] Build a mobile-friendly judge workspace
  - [ ] Show the active round, timer, tables, outstanding results, judge calls, and recently updated matches
  - [ ] Search by player, table, or match and filter to items requiring judge attention
  - [ ] Keep common event-day actions usable without entering the full organizer interface
- [ ] Add per-match time extensions
  - [ ] Record the duration, reason, issuing judge, and timestamp for every extension
  - [ ] Show the cumulative extension and adjusted match deadline to judges and affected players
  - [ ] Audit edits or revocations instead of replacing the original action silently
- [ ] Add structured player warnings and infractions
  - [ ] Anchor conduct records to the durable participant identity so history survives individual registrations
  - [ ] Record the player, tournament, optional match/round/table, category, severity, penalty, notes, judge, and timestamp
  - [ ] Support warnings that do not alter a result and penalties that flow through the normalized adjudication model
  - [ ] Show an authorized judge the player's history within the current event and across prior events
  - [ ] Define the organization/convention boundary within which cross-event history may be viewed
  - [ ] Add append-only corrections, privacy controls, retention rules, and access auditing for sensitive conduct history
- [ ] Add ghost-match handling for unreported matches whose players have left the table
  - [ ] Track ghost status, reporting judge, timestamp, and notes independently from result state
  - [ ] Remove ghost matches from active-table and routine result-reminder views and move them to a judge exception queue
  - [ ] Keep the result unresolved and block ordinary round completion until staff report or adjudicate it; never invent a result or change standings from ghost status alone
  - [ ] Let authorized staff reopen the table state or resolve the match through normal reporting, forfeit, no-show, or DQ adjudication
- [ ] Add authorization and invariant tests for judge actions, cross-event history, time extensions, and ghost matches

## 6. Publication, location, and discovery

Tournament discoverability, participant release, and public publishing are
separate concerns. Model them explicitly before adding more boolean settings.

- [ ] Add artifact publication policies per tournament
  - [x] Keep tournament visibility separate from lifecycle
  - [x] Store per-round pairing release state
  - [x] Support manual or automatic release of newly generated pairings to players
  - [ ] Configure organizer-only, participant, or public audience per artifact
  - [ ] Configure manual, during-event, after-event, or never timing for standings, pairings, and decklists
  - [ ] Enforce publication policy consistently in public, player, and organizer queries
- [ ] Add structured paper-event location data
  - [ ] Store venue name and structured address fields
  - [ ] Store timezone and optional normalized place/coordinate data
  - [ ] Show the location on public and player-facing event surfaces
  - [ ] Add indexes/read models needed for later location filtering
- [ ] Add upcoming-tournament filters
  - [ ] Format
  - [ ] Date range
  - [ ] Location
- [ ] Finish decklist submission and publishing
  - [x] Store one structured decklist per confirmed registration
  - [x] Provide player create/edit/read flows and an organizer deck-check view
  - [x] Lock submission when registration closes and retain submitted lists
  - [x] Validate structural bounds and normalize duplicate card rows server-side
  - [x] Audit initial submissions and resubmissions
  - [ ] Add pasted text import and preserve the submitted raw text
  - [ ] Add format-aware card-count and legality validation with clear warnings/errors
  - [ ] Apply the tournament's decklist publication policy

## 7. Domain events and communications

Use a durable, idempotent domain-event/outbox layer rather than treating the
organizer audit log as a delivery queue. Audit, in-app notifications, email,
push, analytics, and monitoring should be independent consumers.

- [ ] Add a durable domain-event/outbox model for important tournament transitions
- [ ] Emit events for registration changes, event start, pairing publication, round start, timer start, outstanding-result reminders, result changes, and cancellation
- [ ] Add idempotent delivery state and retry handling for external providers
- [ ] Add in-app player-controller notifications for event/round transitions and outstanding player actions
- [ ] Add transactional email
  - [ ] Staff invite emails
  - [ ] Tournament invitation emails
  - [ ] Registration confirmation and status-change emails
  - [ ] Cancellation and refund emails
- [ ] Add native push notification infrastructure
  - [ ] Register installations and device tokens, handle permission state, and retire invalid tokens
  - [ ] Deep-link notifications to the relevant convention, tournament, round, match, or result-entry screen
  - [ ] Track delivery attempts separately from the domain event and make fan-out idempotent
- [ ] Add native push notifications for event start, published round pairings, and round start
  - [ ] Include the player's table and opponent in pairing notifications when publication policy permits it
- [ ] Add configurable reminders for a player to submit an outstanding match result
  - [ ] Schedule reminders from the round/match policy rather than a hardcoded delay
  - [ ] Cancel or suppress reminders when the result is reported, the match is adjudicated, or the match is marked as a ghost match
  - [ ] Prevent duplicate and stale notifications across retries, corrections, round rewinds, and device installations
- [ ] Add per-user, per-event notification preferences and delivery-channel controls
  - [ ] Respect timezone, quiet-hours, and opt-out settings for reminders while preserving required operational notices

## 8. Event-day outputs and client parity

- [ ] Add printable outputs
  - [ ] Pairings by table
  - [ ] Pairings by player name
  - [ ] Result slips
  - [ ] Standings
- [ ] Complete native player-controller parity
  - [x] Show current match, player meetings, live timer, and standings
  - [ ] Report a result (surface mutation errors via
        `mutationErrorMessage` from `@tournament-os/core` so rate-limited
        rejections get the retry-later treatment)
  - [ ] Drop from the event
  - [ ] Show match history
  - [ ] Submit and view decklists
- [ ] Refine the native experience
  - [x] Handle authentication and primary loading states
  - [x] Respect native safe areas
  - [ ] Complete the visual/design pass
  - [ ] Add robust error and empty states across every workflow
  - [ ] Define and implement offline/read-cache tolerance
- [ ] Add real safe-area support to the web app chrome; ship all parts together
  - [ ] Add `viewport-fit=cover` to the root viewport meta in `apps/web/src/routes/__root.tsx`
  - [ ] Add bottom safe-area padding to SiteShell's fixed bottom-bar chrome
  - [ ] Size SiteShell content clearance to footer height plus the bottom inset
  - [ ] Add top safe-area padding to sticky top bars
  - [ ] Audit every web page in portrait and landscape before enabling the site-wide viewport change

## 9. Payments

Record the platform decision early, but implement payment state only after the
admission and cancellation state machines are explicit.

- [ ] Decide platform versus marketplace payment architecture
  - [ ] Evaluate Stripe Connect Standard and Express for organizer payouts
  - [ ] Record ownership of fees, disputes, refunds, tax, and support obligations
- [ ] Add entry-fee settings to tournaments
- [ ] Add separate order, payment, and refund records with idempotent webhook processing
- [ ] Add paid registration and organizer payout onboarding
- [ ] Add cancellation/drop refund rules before tournament start
- [ ] Reconcile payment state with registration transitions without overloading registration status

## 10. Design system and platform polish

- [ ] Establish a design language beyond stock shadcn defaults
  - [x] Share player-facing site chrome through SiteShell
  - [x] Share workspace headers, table states, result badges, and common interaction components
  - [ ] Define semantic color, type, spacing, elevation, and motion tokens
  - [ ] Restyle core organizer and player workflows using the new system
  - [ ] Document reusable composition patterns and accessibility expectations
- [ ] Complete accessibility and keyboard audits for organizer and player workflows
- [ ] Add bundle budgets and performance regression checks

## Completed foundations

- [x] Full tournament settings page with pre-start edit rules
- [x] Cancel tournament and hard-delete it with all child rows
- [x] Admin Overview preview of the public event page
- [x] Markdown event details editing and public rendering
- [x] Synced round timer with organizer controls, progress chip, overtime, and web/native/public display
- [x] Phase player meetings with alphabetical seating
- [x] Append-only typed tournament audit log and paginated organizer Log tab
- [x] Phase add/remove/reorder while the tournament is editable
- [x] Single-elimination phases with top-eight seeding
- [x] Swiss phase cutoffs by rank or match points with rewind support
- [x] Public player profiles with privacy controls, past results, and per-round history
- [x] Responsive desktop player controller
- [x] Player-facing tournament match history
- [x] Sticky admin header and sidebar
- [x] Seeded-random first-round pairings
- [x] Registered-versus-capacity counts on relevant surfaces
- [x] Public-code admin URLs
- [x] Paginated registration, pairing, and standings tables with page-size options
