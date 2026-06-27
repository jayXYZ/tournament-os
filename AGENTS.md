<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`packages/backend/convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Project status: pre-production

This app is **pre-production** — there is no real/production data to protect. The
Convex database can be wiped and reseeded at any time, so you do **not** need to
preserve backward compatibility with existing documents when making changes:

- Skip data migrations and backfills for schema changes; just change the schema.
- New required fields don't need to handle pre-existing rows that lack them.
- Prefer the simplest correct design over one that keeps old data valid.

If a change would otherwise require migrating existing data, note that the DB
should be reset instead.
