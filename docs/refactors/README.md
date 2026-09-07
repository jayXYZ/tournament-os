# Architecture refactors

The ten items from the August 2026 architecture review are complete. Seven
landed earlier (see git history for their original handoff prompts); the final
three now document the resulting conventions:

- [Timeline presentation](07-timeline-module.md): pure progression display logic
  and focused tests.
- [Fixture conventions](09-fixture-consolidation.md): public registration for
  shared workflow fixtures and explicit raw engine seeds.
- [Audit event coupling](10-audit-event-coupling.md): a written audit policy and
  domain operations that own both state changes and journal entries.

## Standing constraints for every refactor

- Pre-production: no data migrations, no backward compatibility; reset the DB
  if a schema change would otherwise need a migration (see `AGENTS.md`).
- Read `packages/backend/convex/_generated/ai/guidelines.md` before touching
  Convex code (regenerate with `pnpm --filter @tournament-os/backend exec convex ai-files install`
  if missing — it is gitignored).
- Backend verification: `pnpm --filter @tournament-os/backend test`.
- Do **not** break up these verified-deep modules — reuse them as internals:
  `model/nextStep.ts`, `model/pairing.ts`, `model/cutoffs.ts`,
  `model/standings.ts`, `setRegistrationState`'s transition typing (now in
  `model/participation.ts`), `decklist-draft.ts`, `SiteShell`, the
  batch-continuation deletion pair.
