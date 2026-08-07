# Refactor 01 — One Convex-auth-readiness seam for player queries

## Context for the agent

You are working in `tournament-os`, a pnpm monorepo: Convex backend
(`packages/backend`), TanStack Start web app (`apps/web`), Expo native app
(`apps/native`), shared React hooks in `packages/tournament-core`, pure shared
utilities in `packages/shared`. Auth is Clerk on the client with Convex
consuming Clerk-issued tokens.

Before touching any Convex code, read
`packages/backend/convex/_generated/ai/guidelines.md`.

The project is **pre-production**: no data migrations or backward compatibility
are needed. Verify backend behavior with `pnpm --filter @tournament-os/backend test`.

## Problem

There is a window after Clerk reports a signed-in `user` but before Convex has
validated the token (`useConvexAuth().isAuthenticated` is still false). An
authed Convex query fired during that window runs unauthenticated and returns
`null` — indistinguishable from "not registered" / "no data". The rule "skip
authed queries until Convex auth is ready" is hand-rolled at every call site,
the copies have diverged, and one call site is missing the gate entirely.

**This bug class has already cost five fix commits**: `322946a` (native home),
`206e448` (native tournament screen), `2538178` (player pages), `3179349`
(public-page registration panel), `39eb016` (decklist render gating).

## Verified current state (checked 2026-08-07)

Gated correctly, each with its own hand-rolled copy:

- `apps/web/src/components/player-controller/player-controller.tsx:50` —
  `useConvexAuth`; query args gated `user && typedTournamentId && convexAuthed`
  at lines 65–67. Explanatory comment at ~55–62.
- `apps/web/src/components/player-controller/decklist/decklist-page.tsx:35-36` —
  same gate **plus** an extra `convexAuthLoading` wait (a stricter drifted
  variant), gates at lines 48–50 and 61.
- `apps/web/src/components/tournament-public-page.tsx:218` —
  `user && convexAuthed ? … : 'skip'` at line 227.
- `apps/native/src/app/index.tsx:23-30` and
  `apps/native/src/app/tournament/[id].tsx:35-43` —
  `isAuthenticated ? args : "skip"`, with near-duplicate comments explaining
  the token-lag window.

**Live bug — the gate is missing here:**

- `apps/web/src/components/player-home.tsx:18` — calls
  `api.tournaments.registrations.listMyTournaments` with `user ? {} : 'skip'`
  and no `useConvexAuth` check at all. During the token-lag window this fires
  unauthenticated.

**Fragile transitive gating (not currently a live bug, but easy to break):**
the two `getMyDecklist` subscriptions
(`player-controller.tsx:76-84`, `decklist-page.tsx:57-62`) do not check
`convexAuthed` directly; they are safe only because they gate on
`hasConfirmedEntry`, which derives from the auth-gated `getMyRegistration`
query. A refactor that decouples them would silently reintroduce the bug.

## Task

Create one hook module in `packages/tournament-core` (the shared React SDK
consumed by both web and native) that owns the readiness rule, e.g.:

- `useAuthedQueryArgs(args) → args | 'skip'` (or a `useAuthedQuery` wrapper) —
  the entire interface is "your args, or `'skip'` until Clerk + Convex
  identity is trustworthy".
- Optionally a `useMyRegistration(tournamentId)` built on it whose contract is:
  **never yield a false "not registered" during the token-lag window** —
  callers see `loading` until the answer can be trusted.

Then convert all the call sites above (including the broken `player-home.tsx`
and both native screens) to use it, deleting the per-site copies and their
duplicated comments. Preserve the strictest existing semantics (the
decklist-page `convexAuthLoading` handling) in the shared implementation.

Note `packages/tournament-core` currently imports `convex/react`; check how
existing hooks in `packages/tournament-core/src/hooks.ts` are written and
follow that pattern so both apps can consume the new hook.

## Acceptance criteria

- No component in `apps/web` or `apps/native` calls `useConvexAuth` to gate a
  query — the rule lives only in the shared module.
- `player-home.tsx` no longer fires `listMyTournaments` before Convex auth is
  established.
- `getMyDecklist` call sites are explicitly (not transitively) safe.
- If a test runner exists for `tournament-core` (see refactor 03), add a test
  matrix for the token-lag states: Clerk loading / Clerk signed-out / Clerk
  signed-in + Convex pending / both ready.
- All existing behavior is otherwise unchanged; backend tests still pass.

## Related work

Refactor 05 (player-access ladder) builds directly on this seam — do not
absorb the five-state page ladder into this hook; keep this module small.
