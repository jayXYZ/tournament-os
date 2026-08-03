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

- [x] Full tournament settings page in the event admin controller
  - [x] Surface existing setup mutations (name, date, capacity, format, rounds) in a proper settings view, with clear rules for what stays editable after the event starts
  - [x] Danger zone: cancel event (exists in backend) and hard-delete event + all child rows (new mutation)
  - [x] Admin Overview tab now previews the public event page (settings moved to the Settings tab)
- [x] Details page: description / prizing / logistics text with markdown editing, rendered on the public tournament page (Tiptap WYSIWYG in Settings, markdown stored on the tournament, rendered on the public page)
- [ ] Location data for paper tournaments (venue name, address; shown publicly, filterable later)
- [x] Round timer
  - [x] Timer state on the tournament (running/paused anchors + default round length) synced via Convex; clients tick locally, cleared when the round completes
  - [x] Timer tab in the tournament manager (start / pause / resume / ±minutes / hold-to-reset, plus the default round length setting)
  - [x] Live countdown chip in the tournament progress bar, linking to the Timer tab
  - [x] Show the live timer in the player controller, public event page, and native app (overtime counts up in red; no automation at zero)
- [x] `player meeting` setting on phases (seat-all-players step before round 1, players seated alphabetically)
- [ ] Organizer result corrections: edit a match result after the round (or event) has completed, with standings recomputation for affected rounds
- [ ] Printable outputs: pairings by table / by name, result slips, standings
- [ ] Organizer "favorite" players persisted across tournaments; filter pairings/standings by favorites
- [x] Audit log of organizer actions (result edits, drops, DQs) for dispute resolution
  - [x] Append-only `tournamentAuditEvents` table capturing actor + typed event payloads (result entries/edits with the replaced result, player and organizer drops, reinstates, registrations, round/tournament lifecycle)
  - [x] Log tab in the tournament manager with a paginated, human-readable feed

### 2. Tournament engine — phases, playoffs, edge cases

Swiss pairing is already solid (seeded shuffle, rematch-minimizing backtracking,
standings-based byes, OMW/GW/OGW tiebreakers). The gaps are multi-phase
structure and playoff support.

- [x] Phase management after creation: add / remove / reorder phases while the tournament is still editable
- [x] Single elimination phase type + proper top-8 seeding from swiss standings (1v8, 4v5, 2v7, 3v6)
- [x] Wire up phase cutoffs: a Swiss phase followed by another Swiss phase can cut to the top X players or to everyone at X+ match points; non-qualifiers are eliminated when the next phase's first round is generated (rewindable, like the top-8 cut)
- [ ] Harden swiss for real-event situations
  - [ ] Draws: intentional draws and game draws (only gameWins/gameLosses are tracked today)
  - [ ] Late entry after round 1 (join with byes or losses per policy)
  - [ ] Mid-round drops and no-shows (match loss handling)
  - [ ] Property-style tests: no rematches until unavoidable, one bye max, bracket integrity across drops
- [ ] Best-of-X / match structure setting per phase (bo1 vs bo3 affects valid result entry)

### 3. Visibility, access & publishing

- [x] Decouple visibility from lifecycle in tournament status: `visibility: public | unlisted | private` is now separate from `lifecycle: setup | registration | in_progress | completed | cancelled` (requires a DB reset; "setup" not "draft" to avoid clashing with the Magic draft format)
- [ ] Publishing settings per tournament: whether standings, pairings, and (eventually) decklists are publicly visible, during and/or after the event
- [ ] Invite-only tournaments (join via link/code, or organizer approval of pending registrations)
- [ ] Enroll players as guests or by email (guest registrations without accounts)
- [ ] Player profiles with past public/published tournament results
- [ ] Decklist submission (prerequisite for decklist publishing; text import + basic validation)
- [ ] Transactional email (staff invites are DB rows matched at sign-in today; registration confirmations, invite emails)

### 4. Player experience (web)

- [ ] Fix web view of player controller — currently renders the mobile layout on desktop; add a responsive desktop layout
- [ ] Real safe-area (notch / home-indicator) support for the app chrome — deliberately deferred: the site's viewport meta does not opt into the notch, so `env(safe-area-inset-*)` resolves to `0px` everywhere and the padding that referenced it was stripped as inert. To revisit, all of the following must land together:
  - [ ] Add `viewport-fit=cover` to the root viewport meta in `apps/web/src/routes/__root.tsx` (the `name: 'viewport'` entry in the route's `head`, currently `width=device-width, initial-scale=1`) — without it every `env(safe-area-inset-*)` below stays `0px`
  - [ ] Re-add `pb-[env(safe-area-inset-bottom)]` to SiteShell's shell-owned fixed bottom-bar chrome in `apps/web/src/components/shared/site-shell.tsx` (the `bottomBar` wrapper: `fixed inset-x-0 bottom-0 z-10 border-t …`), so the tab bar and decklist submit footer clear the home indicator
  - [ ] Size SiteShell's content bottom clearance to footer height + inset: the `pb-24` ternary in `site-shell.tsx` hardcodes the bar's height, so once the bar grows by the inset, content scrolls under it — while a bottom bar is visible use something like `pb-[calc(6rem+env(safe-area-inset-bottom))]` (6rem = the current `pb-24`) instead of the fixed `pb-24`
  - [ ] Pad sticky top bars for the status bar with `pt-[env(safe-area-inset-top)]` site-wide — today the only one is SiteShell's phone app bar (the `sticky top-0` header in `site-shell.tsx`); grep `apps/web/src` for `sticky top-0` before flipping the meta to catch any added since
  - [ ] Audit before enabling: `viewport-fit=cover` is site-wide, not per-page — every page (not just the player-controller surfaces) must be checked for status-bar/notch intrusion at the top, home-indicator overlap at the bottom, and left/right inset intrusion in landscape, before the meta change ships
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
