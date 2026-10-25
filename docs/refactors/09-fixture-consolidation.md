# Backend spec fixtures — conventions

Refactor 09 is done; this page records the conventions it left behind. The
handoff prompt it replaces is in git history.

## Scenarios go through the public seam

`packages/backend/convex/specHelpers.ts` is the one shared fixture module, and
its scenarios build state with the mutations real clients call, so a fixture
cannot drift from write policy:

- `seedTournamentWithPlayers` creates the tournament, publishes it through the
  lifecycle mutation, and seats the field with `registerPlayers`. Capacity
  grows to fit the field.
- `registerPlayers` has players `1..N` (`playerIdentity` numbers) each call
  `registerSelf` under their own identity. Accounts, participants, name
  stamps, the confirmed count, and `player_registered` audit events all come
  from production writes, so audit-journal expectations include the seeded
  registrations. Seat a field after publication: registrations exist only
  once an event is open.
- `playOutCurrentRound` is the only definition. It publishes the round's
  pairings (a no-op once they are out), sweeps every open two-player match at
  the phase's best-of, leaves byes and results already on the board, completes
  the round, and returns `{ round, pairKeys }` for rematch assertions.

## `rawSeed` is the labeled escape hatch

`rawSeed(t, reason, seed)` runs a raw write and refuses a blank reason. Use it
only for state the public seam cannot produce, and say which invariant the
write sidesteps. Never use it to repair a counter or stamp the scenario is
meant to exercise. The shared scenarios keep one: `registerPlayers` pins
`tiebreakRandom` after registration (ascending, descending, or a per-player
function such as a seeded generator), because `registerSelf` hashes the
tournament seed with the player's code.

`seedOrganizer` still writes the organizer, organization, and membership rows
directly. By default it takes the organizer's code from the production
allocator, so accounts that `upsertMe` or `registerSelf` create later never
share it.

## What is still raw, and why

Inline `t.run` seeds remain in per-spec engine and reader tests that build
isolated row-level states with no public path, or only a very long one: guest
registrations (no public guest writer yet), review-flow applications in
`entryTransitions`, thousand-row payment and roster budgets, cross-tournament
registration history in `users-profile`, private live events, and a seat in a
setup-stage event. When you touch one of these, convert it to a scenario if a
public path exists. Otherwise wrap it in `rawSeed` with its reason.
