# Tournament OS roadmap

This roadmap was audited against the current implementation and reordered to
build reusable domain foundations before client polish or provider-specific
integrations. A checked child under an open parent records foundation that is
already in place; the parent remains open until all of its acceptance criteria
are satisfied.

Tasks that cannot proceed yet carry an explicit "(blocked on …)" note naming
the prerequisite. Treat these markers as authoritative when picking the next
open task — skip blocked items without re-deriving the block, and when a task
turns out to be blocked (on other sections, human-only account/dashboard
steps, or plan tiers), add the note rather than leaving it implicit.

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
  - [x] Run `scripts/setup-error-monitoring.sh` to create the Sentry
        projects and capture DSNs/credentials (human-only account setup; see
        `docs/error-monitoring.md`)
  - [ ] Enable Convex exception reporting to Sentry in the deployment
        dashboard — blocked on the team being on Convex Pro (the integration
        is Pro-only; no code side exists)
- [x] Add rate limiting and abuse controls to public queries and mutations
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
  - [x] Fix the Vercel build boundary: `apps/web/vercel.json` now runs
        `convex deploy` from the backend package via
        `pnpm --filter @tournament-os/backend exec`, invokes the web build
        explicitly with `--cmd 'pnpm --filter @tournament-os/web run build'`,
        and passes `--cmd-url-env-var-name VITE_CONVEX_URL` — all pnpm, no
        npx/npm
  - [ ] Verify an actual Vercel production deploy end-to-end (blocked on
        human-only dashboard setup: `CONVEX_DEPLOY_KEY` in the Vercel
        project and confirming the root directory is `apps/web` with
        workspace-root install)
- [ ] Configure and verify the custom domain (blocked on human-only
      registrar/DNS and Vercel dashboard setup; any code-side follow-ups
      such as allowed auth origins land once the domain exists)
- [x] Address the oversized web settings chunk: `MarkdownEditor` (TipTap/
      ProseMirror) now lazy-loads behind Suspense in the event-details card,
      shrinking the settings route chunk from 493 kB to 15 kB with the editor
      in its own on-demand 480 kB chunk; verified in-browser on the settings
      page
- [x] Finish the pnpm 11 settings migration
  - [x] Move `node-linker=hoisted` from `.npmrc` into `pnpm-workspace.yaml` as
        `nodeLinker: hoisted` (`.npmrc` deleted); verified with a clean
        reinstall that the layout is genuinely hoisted — no `.pnpm` virtual
        store, no per-package `node_modules`, react and convex resolve as
        root singletons
  - [x] Delete the `ignoredBuiltDependencies`/`onlyBuiltDependencies` keys
        (removed in pnpm 11) and fold them into `allowBuilds`, adding the
        missing `sharp: false`
- [x] Commit environment contracts
  - [x] Add a `!**/.env.example` exception to `.gitignore` and commit the
        native and web examples (each now also lists the optional Sentry vars)
  - [x] Document required variables in `docs/environment.md` — web
        (`VITE_CONVEX_URL`, `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`),
        native (the two `EXPO_PUBLIC_*` vars), Convex deployment
        (`CLERK_JWT_ISSUER_DOMAIN`, `PROFILE_RESULTS_CURSOR_KEY`) — with
        production locations (Vercel/EAS/`convex env set`) and a README pointer
  - [x] Add typed environment declarations via `defineApp({ env })` in the
        backend `convex.config.ts` (`CLERK_JWT_ISSUER_DOMAIN` required,
        `PROFILE_RESULTS_CURSOR_KEY` optional with its dev fallback);
        `auth.config.ts` and `model/playerResults.ts` now read the typed `env`
        from `_generated/server` and the auth config is
        `satisfies AuthConfig`; verified by a dev deploy, backend tsc, and the
        backend test suite
- [x] Expand CI beyond `pnpm test`: the workflow now runs four isolated jobs —
      test; checks (`pnpm lint`, `pnpm typecheck`, `pnpm format:check`); a
      native smoke job (`expo install --check` plus an ios+android
      `expo export`, since the native package has no test script); and the
      lockfile dedupe check, which must stay an isolated final job because
      `pnpm dedupe --check` silently strips hoisted packages from
      `node_modules` even when it passes (pnpm 11.9.0); all jobs verified
      green locally
- [x] Lint the backend: `packages/backend` now has its own flat ESLint config
      (typescript-eslint recommended plus the Convex plugin's recommended
      rules, `_`-prefix escape hatch for intentionally unused identifiers,
      `_generated` ignored), a `lint` script gated at zero warnings, and a
      root `lint:backend` step wired into `pnpm lint`; landing it required
      aligning the backend on TypeScript 6 (below) and making the node types
      the backend specs rely on explicit via `"types": ["node"]` in
      `convex/tsconfig.json`, since TypeScript 6 no longer auto-includes
      hoisted `@types` packages
- [x] Add a unified root check command covering tests, package typechecks,
      lint, and `format:check`
  - [x] Add root `format`, `format:check`, and `typecheck` scripts and make
        the whole repo prettier-clean (the root `.prettierignore` restates
        nested build-output ignores because prettier only reads the ignore
        files in its working directory)
  - [x] Give `packages/shared` and `packages/tournament-core` standalone
        `tsconfig.json` files and `typecheck` scripts (modeled on the web
        config; shared stays ES-lib-only since it is dependency-free, core
        adds the DOM lib for its timer globals; both pin `typescript` to the
        workspace-wide `^6.0.3` range) — this also brings their test files
        under typechecking for the first time, since the web program only
        pulled in the package sources it imports
  - [x] Add the single root command: `pnpm check` runs `format:check`,
        `typecheck`, `lint`, then `pnpm test`, ordered fast-to-slow so it
        fails quickly; verified green locally (CI keeps its isolated
        parallel jobs on purpose — see the lockfile-job note — so `check`
        is the local one-shot equivalent, not a CI step)
- [x] Pin the toolchain on Node 24 LTS and pnpm 11.9.0: root
      `"packageManager": "pnpm@11.9.0"` (local pnpm self-switches to it and
      CI's pnpm/action-setup reads it, replacing the hardcoded version),
      `.nvmrc` pinning 24 with every CI job on `node-version-file`, and
      `"engines": { "node": ">=24" }` in the root and `apps/web` manifests —
      the web copy matters because Vercel picks its build/function runtime
      from the project-root-directory package.json, and Node 24 is Vercel's
      default LTS (26 is sandbox-only there). Local Homebrew Node 26
      satisfies the floor; no local version manager reads `.nvmrc`, so it
      binds CI and documents intent without breaking local dev
- [x] Align duplicated workspace dependency versions via pnpm catalogs:
      `pnpm-workspace.yaml` now declares one range each for convex, expo,
      react, react-dom, react-native, typescript, vite, and vitest, and every
      manifest references them with the `catalog:` protocol (the drift was
      declaration-only — the lockfile already resolved singletons, e.g.
      native's `^1.39.1` convex range installed 1.42.0). The react-family
      catalog entries are exact and must stay in lockstep with the workspace
      `overrides` block, which still force-pins transitive react/react-dom
      for Metro; tournament-core's convex peer range bumped to `^1.42.0`,
      while peer ranges stay literal since they state compatibility, not
      installs. Verified with `pnpm check`, `expo install --check` (Expo CLI
      resolves `catalog:` ranges fine), and an ios+android `expo export`
  - [x] Align TypeScript on 6.0.3 across web, native, and backend — the
        backend's old `^5` range made pnpm resolve a second
        `@typescript-eslint` peer-variant with a TypeScript 5.9.3 copy nested
        inside the hoisted packages, which silently downgraded the web app's
        type-aware lint to a program without `strictNullChecks` (≈1,100 false
        `no-unnecessary-condition` errors)
- [x] Pin the patched `@clerk/expo` exactly and version-qualify its
      `patchedDependencies` entry: apps/native now depends on `3.4.6` (no
      caret) and `pnpm-workspace.yaml` keys the patch as `@clerk/expo@3.4.6`,
      so bumping the package fails loudly until the Swift patch is re-derived
      instead of silently (mis)applying; verified with `pnpm check` and
      `expo install --check`
- [ ] Simplify `apps/native/metro.config.js`: Expo SDK 56 supplies
      `watchFolders` and `nodeModulesPaths` automatically; keep the singleton
      resolver until a native smoke test proves it unnecessary

## 1. Result and adjudication foundation

Build one result model and transition path before adding more result-entry
surfaces. It should support played results, corrections, draws, forfeits,
no-shows, and disqualifications without each workflow inventing its own rules.

- [x] Add a match policy to each phase (best-of-1/3/5, default 3, pre-start
      editable — see CONTEXT.md "Match Structure"): `bestOf` on
      `tournamentPhases` (required field — reset the dev DB), a Match
      structure selector in the phase editor, and shared rules in
      `@tournament-os/shared/match-structure`
  - [x] Configure Best-of-X / match structure per phase
  - [x] Derive valid result entry from the phase policy instead of hardcoding
        0–2 game wins: `requireValidMatchResult` in the one result writer
        enforces each side ≤ required wins and non-drawn games ≤ X, byes and
        the test simulator award structure-relative scorelines, and both
        result-entry UIs cap inputs at the required wins (the drawn-games ≤ 3
        bound lands with game-draw tracking in the adjudication model below,
        since drawn games are not yet recorded)
  - [x] Define whether draws are allowed for the phase type: fixed by phase
        type, not configurable — equal game wins is a valid Swiss match draw
        at any structure (0–0 in best of 1, 2–2 in best of 5) and never valid
        in single elimination; recording drawn games themselves lands with the
        adjudication model below
- [ ] Replace the wins-only result shape with a normalized adjudication model
  - [ ] Track game wins, game losses, and game draws
  - [ ] Compute match-win and game-win percentages from match/game points so drawn games count (MTR Appendix C)
  - [ ] Exclude byes from a player's percentages where they feed opponents' tiebreakers
  - [ ] Break residual perfect ties with a per-player random value fixed for the tournament instead of registration time
  - [ ] Distinguish played results, intentional draws, concessions, forfeits, no-shows, byes, and DQs (Intentional draws can't be distinguished, a 0-0 ID looks the same as a match that went to time game 1 and resulted in a draw)
  - [ ] Keep immutable result revisions and identify the current result
  - [x] Preserve the previous result in the organizer audit trail for active-round overrides
- [ ] Remove opponent result confirmation — the confirmed match status, mutation, and player UI; disputes resolve through organizer override
- [x] Result corrections are active-round-only by design (decided 2026-08-12):
      organizers override results in the open round, and rewinding the latest
      untouched round reopens the previous round for fixes — including
      re-drawing a cut by rewinding the next phase's first round. Mistakes
      buried under completed rounds stand and a completed tournament is
      final, so no forward standings-recompute or cutoff-correction mechanism
      exists (see CONTEXT.md "Rewind")
  - [x] Allow organizers to enter or override results during the active round
  - [x] Recompute standings when an active round is completed
  - [x] Rewind the latest untouched round and reopen the preceding round
- [ ] Complete real-event drop and adjudication handling
  - [x] Allow organizer and player drops during an event
  - [x] Keep a dropped player's current pairing available so its result can still be reported
  - [ ] Record a mid-round drop as an immediate concession — required-wins–0
        for the opponent, no per-tournament configuration; a finished match is
        reported before the drop or fixed by organizer override afterwards
  - [ ] Add organizer no-show and forfeit actions (no-show defaults to also
        dropping the player, organizer can keep them in; both players absent
        is a double match loss)
  - [ ] Replace bracket loser-revival with walkovers: the scheduled opponent receives a 2–0 bye when a bracket player leaves before their match; walkovers may chain; departed players keep the placement of the seat they reached (see ADR 0001)
  - [ ] Complete the organizer DQ workflow (MTR/IPG-aligned — see `CONTEXT.md`)
    - [ ] Remove DQ'd players from standings entirely so every lower-ranked player advances one place, deleting the mask-as-drop machinery this replaces
    - [ ] Keep a DQ'd player's completed matches on record and feeding former opponents' tiebreakers, with the tournament staying on their profile without a placement
    - [ ] Add an organizer-authorized DQ action and participation-state transition
    - [ ] Record each DQ as a typed, organizer-only audit event with the actor and affected player
    - [ ] Apply the DQ's match consequence: the disqualified player loses
          their current match when it is unresolved (IPG 1.1); an
          already-reported result is never flipped, and the DQ action exists
          only while the tournament is in progress
- [ ] Add late entry after round 1 (blocked on an organizer
      manual-registration feature — section 3's admission work; players never
      self-join a started tournament)
  - [ ] Admit a late player by organizer override during the first phase
        only, with player capacity still applying
  - [ ] Record an opponent-less missed-round loss (zero game wins, required
        wins against) for every already-generated round, counting toward the
        player's own match points and GWP but excluded when their percentages
        feed opponents' tiebreakers (see CONTEXT.md "Missed Round")
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
  - [ ] Bar re-entry to a private event after organizer removal (launch-blocking): a cancelled registration must stop acting as a standing invitation once the player is rejected (blocked on the organizer approval/rejection write side above)
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
  - [ ] Fix or drop the native app's web target: `expo export --platform web`
        fails in the router's static render (`requireNativeComponent` is not
        a function), so the native build script and the CI smoke check export
        ios+android only
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
