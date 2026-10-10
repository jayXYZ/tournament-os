---
name: verify
description: How to drive the tournament-os web app end-to-end for verification — headless sign-in past Google-only Clerk auth, seeding a test tournament, and advancing rounds.
---

# Verifying tournament-os in the running app

## Handles

- Dev server: `vite dev` from `apps/web/` (usually already running on http://localhost:3000; check `lsof -iTCP:3000`). Convex backend is a cloud dev deployment — no local process needed for frontend-only changes.
- Browser: Playwright chromium installed in a scratchpad dir (`npm i playwright && npx playwright install chromium`), persist auth via `context.storageState({ path })`.

## Auth (the tricky part)

The app's Clerk sign-in is **Google OAuth only** — you cannot sign in through the UI headlessly. Instead mint a sign-in ticket with the Backend API using `CLERK_SECRET_KEY` from `apps/web/.env.local`:

1. `POST https://api.clerk.com/v1/users` `{ email_address: ["x@example.com"], skip_password_requirement: true }` (or look up an existing one via `GET /v1/users?email_address=...`).
2. `POST /v1/sign_in_tokens` `{ user_id }`.
3. In the app page: `await window.Clerk.client.signIn.create({ strategy: 'ticket', ticket })` then `await window.Clerk.setActive({ session: res.createdSessionId })` (wait for `window.Clerk?.loaded` first).

A fresh user can self-serve everything: create an organization from the breadcrumb "Select organization" menu → "Create organization".

## Building a tournament with rounds

1. Admin → "Create new tournament". Required: Name, **Start date** (datetime-local — creation silently no-ops if empty), Capacity. Check "Mark as test event". Phase rows: rounds-mode combobox (Fixed/Dynamic) + "Total rounds" input; "Add Swiss phase" adds more phases.
2. Manager → Registrations → gear ("Registration settings") → "Generate Test Users" fills to capacity with dummy players (test events only).
3. Advance loop: hold the advance HoldButton (pointer down ~1.3s: `mouse.down()`, wait, `mouse.up()`) → "Hold to generate pairings"; then Pairings gear ("Pairings settings") → "Simulate Match Results"; then "Hold to generate standings". Repeat per round; ends at "Hold to complete tournament".

## Gotchas

- Only the first Swiss phase is ever advanced by the backend; later phases stay `upcoming`.
- Pre-production: dev DB is wipe-anytime, so leftover test orgs/tournaments are acceptable; note them in the report.
