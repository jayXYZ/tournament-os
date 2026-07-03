# Tournament OS

Monorepo for Tournament OS — organizer workspaces and event operations for Magic tournaments.

## Workspaces

- `apps/web` — TanStack Start web app (Clerk auth, Convex data). The primary app.
- `packages/backend` — Convex backend (schema, functions, generated API) shared by web and mobile.
- `packages/tournament-core` — framework-agnostic tournament/organizer domain logic shared across apps.

## Getting started

Install dependencies from the repo root:

```bash
pnpm install
```

Run the web app and the Convex backend together:

```bash
pnpm dev
```

Or individually:

```bash
pnpm dev:frontend   # apps/web (Vite, port 3000)
pnpm dev:backend    # packages/backend (convex dev)
```

## Scripts

- `pnpm build` — build the web app
- `pnpm start` — serve the built web app
- `pnpm lint` — lint the web app

## Roadmap

Grouped by theme, in rough build order. Milestones 1–2 get a real paper event
run end-to-end; 3–4 make the platform public-facing; 5–7 grow it into a product.

### 1. Event admin controller — run a real event

The organizer needs everything for event day in one place: configuration,
content, and live round operations.

- [ ] Full tournament settings page in the event admin controller
  - [ ] Surface existing setup mutations (name, date, capacity, format, rounds) in a proper settings view, with clear rules for what stays editable after the event starts
  - [ ] Danger zone: cancel event (exists in backend) and hard-delete event + all child rows (new mutation)
- [ ] Details page: description / prizing / logistics text with markdown editing, rendered on the public tournament page
- [ ] Location data for paper tournaments (venue name, address; shown publicly, filterable later)
- [ ] Round timer
  - [ ] Timer state on rounds (duration, startedAt, pause/extend) synced via Convex
  - [ ] Timer controller page in the admin panel (start / pause / add time)
  - [ ] Timer + "current state" (round, phase, outstanding matches) component in the admin header
  - [ ] Show the live timer in the player controller and public views
- [ ] `player meeting` setting on phases (seat-all-players step before round 1, with printable/displayable seating)
- [ ] Organizer result corrections: edit a match result after the round (or event) has completed, with standings recomputation for affected rounds
- [ ] Printable outputs: pairings by table / by name, result slips, standings
- [ ] Organizer "favorite" players persisted across tournaments; filter pairings/standings by favorites
- [ ] Audit log of organizer actions (result edits, drops, DQs) for dispute resolution

### 2. Tournament engine — phases, playoffs, edge cases

Swiss pairing is already solid (seeded shuffle, rematch-minimizing backtracking,
standings-based byes, OMW/GW/OGW tiebreakers). The gaps are multi-phase
structure and playoff support.

- [ ] Phase management after creation: add / remove / reorder phases while the tournament is still editable (currently only phase 1 is configurable)
- [ ] Single elimination phase type + proper top-8 seeding from swiss standings (1v8, 4v5, 2v7, 3v6)
- [ ] Wire up phase cutoffs (`top_X_players` / `X_points_or_more` exist in the schema but are unused): completing a phase should eliminate non-qualifiers and seed the next phase
- [ ] Harden swiss for real-event situations
  - [ ] Draws: intentional draws and game draws (only gameWins/gameLosses are tracked today)
  - [ ] Late entry after round 1 (join with byes or losses per policy)
  - [ ] Mid-round drops and no-shows (match loss handling)
  - [ ] Property-style tests: no rematches until unavoidable, one bye max, bracket integrity across drops
- [ ] Best-of-X / match structure setting per phase (bo1 vs bo3 affects valid result entry)

### 3. Visibility, access & publishing

- [x] Decouple visibility from lifecycle in tournament status: `visibility: public | unlisted | private` is now separate from `lifecycle: setup | registration | in_progress | completed | cancelled` (requires a DB reset; "setup" not "draft" to avoid clashing with the Magic draft format)
- [ ] Publishing settings per tournament: whether standings, pairings, and (eventually) decklists are publicly visible, during and after the event
- [ ] Invite-only tournaments (join via link/code, or organizer approval of pending registrations)
- [ ] Enroll players as guests or by email (guest registrations without accounts; claimable later via the public player code)
- [ ] Player profiles with past public/published tournament results
- [ ] Decklist submission (prerequisite for decklist publishing; text import + basic validation)
- [ ] Transactional email (staff invites are DB rows matched at sign-in today; registration confirmations, invite emails)

### 4. Player experience (web)

- [ ] Fix web view of player controller — currently renders the mobile layout on desktop; add a responsive desktop layout
- [ ] Filtering for the upcoming-tournaments table (format first; then date range and location)
- [ ] Player-facing match history and round-by-round results on the tournament page
- [ ] Notifications in the player controller when new pairings post or the timer starts

### 5. Mobile app

- [ ] Wire player result reporting into the native app (hooks already exist in `@tournament-os/core`)
- [ ] Reach parity with the web player controller: current match, standings, drop, confirm results
- [ ] Push notifications for new pairings and round start
- [ ] Refine mobile app experience (design pass, loading states, offline tolerance)

### 6. Payments

- [ ] Stripe integration for paid entry
  - [ ] Decide platform vs marketplace (Stripe Connect for organizer payouts vs single merchant) — Connect Standard/Express is the likely fit since organizers collect entry fees
  - [ ] Entry fee setting on tournaments; paid registration flow; refunds on cancel/drop before start

### 7. Design & platform quality

- [ ] Overhaul UI components — establish a design language beyond stock shadcn defaults
- [ ] E2E test coverage of the organizer happy path (create → publish → register → rounds → complete)
- [ ] Production readiness: Convex prod deployment, custom domain, error monitoring, rate limiting on public queries

### Done

- [x] Make header and sidebar in admin panel sticky
- [x] First round pairing (was alphabetical; now seeded random)
- [x] Show players registered vs capacity wherever capacity is shown
- [x] Admin URLs use public code instead of tournament id
- [x] Paginate registration/pairing/standings tables with page-size options
