# Refactor 08 — Share current-match semantics between web and native

## Context for the agent

You are working in `tournament-os`, a pnpm monorepo. Player surfaces exist
twice: `apps/web/src/components/player-controller/` and
`apps/native/src/app/`. Shared React hooks live in
`packages/tournament-core` (which both apps already consume); the backend
query is `getMyCurrentMatch` in `packages/backend/convex/tournaments/player.ts`.
**Read `packages/backend/convex/_generated/ai/guidelines.md` before touching
Convex code.** Pre-production; verify backend with
`pnpm --filter @tournament-os/backend test`.

## Problem

What each `MyCurrentMatch` kind _means_ to a player — title, body copy, tone —
is written twice (web and native) and the union itself is built inline in the
Convex endpoint, so the branching is testable only end-to-end. The two copy
sets drift independently. Several other player-facing rules are duplicated
across the two apps the same way.

## Verified current state (checked 2026-08-07)

- **Web**: `apps/web/src/components/player-controller/current-match-card.tsx`
  — if-chain on `currentMatch.kind`: `'not_started'` (:41),
  `'player_meeting'` (:51), `'between_rounds'` (:90), `'pairings_pending'`
  (:104), `'no_match'` (:114), plus the real-match rendering — each branch
  carrying its own titles/copy/tones.
- **Native**: `apps/native/src/app/tournament/[id].tsx:171` — a
  `switch (current.kind)` over the same kinds with parallel, independently
  written strings.
- **Backend**: `getMyCurrentMatch` in
  `packages/backend/convex/tournaments/player.ts` builds the union inline in
  the query handler (~170 lines of branching; the continue-vs-advance
  derivation at ~:147 is one of three copies of that rule — see
  `docs/refactors/02-progression-module.md`).
- Additional web/native duplications verified in the same files: the
  registration gate explanation comments (player-controller.tsx:55-62 vs
  native [id].tsx:32-40, near-identical), timer presentation policy, and
  standings-row labeling.

## Task

1. **Pure description module in `packages/tournament-core`**:
   `describeCurrentMatch(currentMatch) → { title, body, tone, … }` — one
   branch per kind, no React, no platform imports. Web's
   `current-match-card.tsx` and native's `[id].tsx` become thin adapters that
   render the description with their own widgets. Reconcile the two existing
   copy sets deliberately (pick the better wording once); note in the PR
   description any user-visible copy that changed.
2. **Backend model extraction**: move the union construction out of the query
   handler into a `model/playerView.ts` (e.g. `currentMatchForPlayer(...)`)
   so the endpoint becomes auth + one call, and each kind branch is testable
   with fixture docs instead of full E2E flows. Do not change the wire shape
   of `getMyCurrentMatch` — both apps depend on it.
3. **Scope control**: the other duplications (timer presentation, standings
   labels) are worth noting but only fold them in if they fall out naturally;
   the core deliverable is the current-match meaning.

## Acceptance criteria

- The kind→presentation mapping exists once, in `tournament-core`, with one
  unit test per kind (runner from refactor 03).
- Web and native render from the shared description; neither contains its own
  kind-switch copy strings.
- `getMyCurrentMatch` endpoint is a thin adapter; existing
  `tournaments-player.convex.spec.ts` tests pass unchanged.
- No wire-format changes.
