<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`packages/backend/convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

That file is gitignored, so it may be missing on a fresh clone — regenerate it
(and the Convex agent skills) with
`pnpm --filter @paper-pairings/backend exec convex ai-files install`.
npm/npx/yarn/bun are denied in this repo; always use pnpm.

<!-- convex-ai-end -->

## Orientation

- `CONTEXT.md` — the competitive-engine domain glossary. Code comments cite it
  by entry name; it is the source of truth for pairing/scoring/standings
  vocabulary.
- `TODO.md` — the audited roadmap: what is done, open, and blocked.
- `docs/` — environment contract, payments architecture, rate limiting, error
  monitoring, ADRs (`docs/adr/`), and the refactor backlog (`docs/refactors/`).
- Verification gate: `pnpm check` (format + typecheck + lint + test — what CI
  runs). Backend tests alone: `pnpm --filter @paper-pairings/backend test`.
- Conventions: backend domain logic lives in `packages/backend/convex/model/`
  with thin public function adapters beside it; backend specs are
  `*.convex.spec.ts` seeded through `specHelpers.ts`.

## Project status: pre-production

This app is **pre-production** — there is no real/production data to protect. The
Convex database can be wiped and reseeded at any time, so you do **not** need to
preserve backward compatibility with existing documents when making changes:

- Skip data migrations and backfills for schema changes; just change the schema.
- New required fields don't need to handle pre-existing rows that lack them.
- Prefer the simplest correct design over one that keeps old data valid.

If a change would otherwise require migrating existing data, note that the DB
should be reset instead.
