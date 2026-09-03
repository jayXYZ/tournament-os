# Convex backend

Read `_generated/ai/guidelines.md` before touching this directory — it is the
authority on Convex API usage and is gitignored, so regenerate it with
`pnpm --filter @tournament-os/backend exec convex ai-files install` if it is
missing.

Layout:

- `model/` — the internal layer. All domain logic and multi-table writes live
  here as plain functions over `ctx`; public functions call into it. Deep
  modules (`progression.ts`, `pairing.ts`, `standings.ts`, `nextStep.ts`,
  `matchResults.ts`, `cutoffs.ts`, …) should be reused, not broken up.
- `tournaments/`, `payments/`, `stripe/`, plus top-level files
  (`organizations.ts`, `users.ts`, …) — the public function surface: thin
  auth + validation adapters over `model/`.
- `validators.ts` — shared value unions (statuses, result kinds, the audit
  event validator). Domain vocabulary is defined once here; `CONTEXT.md` at
  the repo root is the prose glossary it mirrors.
- `schema.ts` — the whole database schema.
- `*.convex.spec.ts` — the test suite (vitest + convex-test), seeded through
  `specHelpers.ts`. Run with `pnpm --filter @tournament-os/backend test`.

The CLI runs through the workspace: `pnpm dev:backend` from the repo root, or
`pnpm --filter @tournament-os/backend exec convex <cmd>` (npm/npx are denied
in this repo).
