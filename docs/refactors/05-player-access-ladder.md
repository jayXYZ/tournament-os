# Refactor 05 — One player-access module for the /play and /decklist pages

## Context for the agent

You are working in `tournament-os`; the web app is TanStack Start in
`apps/web`, shared React hooks live in `packages/tournament-core`, auth is
Clerk + Convex. Pre-production; no compatibility constraints.

**Dependency:** refactor 01 (`docs/refactors/01-auth-readiness-seam.md`)
creates the auth-readiness hook this module should consume. If it has not been
done, read that document — do not re-implement the readiness rule here.

## Problem

The two hottest player-facing files each implement the same access state
machine — loading / tournament-not-found / signed-out / not-registered /
ready — as a ladder of early returns, kept in lockstep by hand. Every gating
fix must be made twice, and the two copies have already drifted (the decklist
variant waits on `convexAuthLoading`; the controller does not). Shared layout
constants are coupled by comment rather than code.

## Verified current state (checked 2026-08-07)

- `apps/web/src/components/player-controller/player-controller.tsx`
  (514 lines) — Clerk user + `useConvexAuth` (:50) + event lookup by public
  code + `getMyRegistration` gated at :65-67 +
  `hasConfirmedEntry = registration?.entryStatus === 'confirmed'` (:69),
  then ~6 early-return shells (~L127–247): loading skeleton, not-found,
  sign-in, registration skeleton, not-registered, then the real page.
  Comments at :55-62 explain the null-vs-not-registered trap and note the
  gate must "match the server's requireRegisteredPlayer".
- `apps/web/src/components/player-controller/decklist/decklist-page.tsx`
  (337 lines) — mirrors the same ladder ~1:1 (~L74–175) with the stricter
  `convexAuthLoading` variant (:35-36), plus its own
  `hasConfirmedEntry`-gated `getMyDecklist` (:57-62).
- Shell width is aligned between the two pages by lockstep comments
  (`shellWidth` / `width="6xl"`), not shared code.
- Contrast: `admin-auth-gate.tsx` already demonstrates the desired
  gate-module shape on the organizer side.

## Task

Extract the ladder into one module with two adapters:

- `usePlayerTournamentAccess(publicCode)` in
  `apps/web/src/components/player-controller/` (or `packages/tournament-core`
  if it stays free of web-only imports) returning a discriminated union:
  `{ state: 'loading' } | { state: 'notFound' } | { state: 'signedOut' } |
  { state: 'notRegistered', event } | { state: 'ready', event, registration }`.
  Internally it composes refactor 01's auth-readiness hook, the event lookup,
  and the confirmed-entry rule (`entryStatus === 'confirmed'` — keep the
  comment explaining it matches the server's `requireRegisteredPlayer`).
- A `PlayerAccessShell` (or equivalent) component that renders the four
  non-ready states **once** — the current Empty compositions, skeletons, and
  sign-in prompts — and owns the shared shell width constant, so the
  comment-coupling becomes code.
- `player-controller.tsx` and `decklist-page.tsx` become adapters: call the
  hook, delegate non-ready states to the shell, render their real content
  only in `ready`. The controller should shed roughly its ~120 lines of
  gating.

Preserve the strictest existing semantics from the decklist variant. Do not
change any backend code.

## Acceptance criteria

- The five-state ladder exists once; both pages consume it.
- No behavioral regression in either page across: signed-out visit, wrong
  public code, signed-in-but-unregistered, cancelled registration
  (`entryStatus !== 'confirmed'` must land in not-registered, not ready),
  and the Convex token-lag window (must show loading, never a false
  "not registered").
- Shared width constant referenced from one exported value.
- If a web test runner exists (refactor 03), add one branch-table test
  covering the five states of the hook.
