# Backend test fixtures

The shared `seedTournamentWithPlayers` scenario now publishes through the
lifecycle mutation and admits every player through `registerSelf`. Identity
creation uses `users.upsertMe`; capacity and confirmed counts are maintained
by production writes. The fixture raises capacity to fit the requested field.

`playOutCurrentRound` has one definition in `specHelpers.ts`, shared by the
main engine suite and the smaller suites. It publishes pairings, respects the
phase's best-of setting, preserves awarded results, and returns pair keys for
rematch assertions.

Use `rawSeed(t, reason, callback)` for states deliberately outside the public
workflow. Current shared exceptions are deterministic public codes/tiebreaks,
missing denormalized names for fallback-reader coverage, and the explicitly
named `rawSeedActiveRegistrations` fixture for legacy pre-publication engine
scenarios. The latter stays raw because its callers test setup-state behavior
and fixed identities; publishing inside it would change the scenario.

Per-spec row-level engine tests can still construct isolated states. When
converting or adding integration scenarios, use public mutations; explain any
raw write with the invariant being bypassed. Do not silently repair counters
in a scenario intended to verify real registration behavior.

Validation: the backend suite retains its existing tests; audit expectations
now include the real player-registration events produced by scenario setup.
