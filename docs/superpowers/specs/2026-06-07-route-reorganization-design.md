# Route Reorganization Design

## Goal

Make Tournament OS open to a player-first default experience. The root route (`/`) should show upcoming tournaments in a table. Organizer controls should move to a separate `/admin` route that users can reach with a clear button from the player view.

## Context

The current app has one frontend page at `app/page.tsx`. That page handles signed-out marketing/auth UI and, once authenticated, shows organizer workspace controls for organizations, members, and invitations. Tournament domain tables and functions already exist in Convex, including tournament registration and public/private status concepts.

Next.js 16 uses App Router file-based routes. The implementation should keep the root layout in `app/layout.tsx`, keep routable UI under `app/`, and use `next/link` for navigation between `/` and `/admin`.

## Recommended Route Shape

Use two public URLs:

- `/`: player home and default app entry.
- `/admin`: organizer control surface.

This is intentionally simpler than adding route groups or deep nested admin routes now. The UI can later grow into route groups or nested admin sections without changing the public behavior.

## Player Home

The root route should be centered on a tournament table. It should show all upcoming public tournaments using a bounded Convex query. The table should include:

- Tournament name.
- Format.
- Start date.
- Player capacity.
- Status.
- A final action column reserved for player actions such as registration.

If there are no upcoming public tournaments, the page should show a calm empty state instead of organizer setup content. The top bar should include the Tournament OS identity, auth controls, and an `Admin` button linking to `/admin`.

Signed-out users can still see the upcoming tournament table. Authentication is only needed for player-specific actions or admin operations.

## Admin Screen

The `/admin` route should hold the organization controls currently shown to authenticated users on `/`:

- Organization selection.
- Create organization form.
- Organization metrics.
- Member list.
- Invite staff form.
- Invitation list.

The admin screen should keep the existing WorkOS and Convex auth behavior. If a user is signed out, it should prompt them to sign in before showing organizer controls. The header should include a `Player view` button linking back to `/`.

## Data Flow

Add or reuse a Convex query for player-facing tournaments. If adding a query, name it clearly, such as `listUpcomingPublic`, and keep it bounded. The query should avoid table scans by adding an index that supports listing public tournaments by status and start date.

The admin route can continue using the existing organization queries and actions:

- `api.users.upsertMe`
- `api.organizations.listMine`
- `api.organizations.getById`
- `api.organizations.listMembers`
- `api.organizations.listInvitations`
- `api.organizations.createOrganizerOrganization`
- `api.organizations.inviteMember`

## Component Boundaries

Keep route files small:

- `app/page.tsx` should compose the player view.
- `app/admin/page.tsx` should compose the admin view.
- Shared client UI can live in a local app component module, such as `app/components/app-header.tsx`.
- Larger player/admin surfaces can be extracted into colocated components if `page.tsx` would otherwise stay too large.

## Error And Loading Behavior

Use existing Convex client loading states for authenticated/admin data. The player tournament table should handle loading, empty, and populated states. Errors can use the current pattern of user-readable notices where mutations are involved.

## Testing And Verification

Follow test-first implementation for behavioral changes:

- Add a failing Convex test for the public upcoming tournament query before implementing it.
- Verify the query returns only public upcoming tournaments and remains bounded.
- Run the relevant Vitest/Convex tests.
- Run lint and `next build` after route changes.

## Non-Goals

This change does not add full tournament detail pages, registration actions, payment, bracket views, or deep admin navigation. It prepares the route structure for those features without building them now.
