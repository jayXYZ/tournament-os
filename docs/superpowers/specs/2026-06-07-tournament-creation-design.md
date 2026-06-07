# Tournament Creation Design

## Goal

Add tournament creation to the organizer workspace. Organizers should be able to create a private tournament draft for the selected organization, and every created tournament must have at least one Swiss phase.

## Context

The organizer workspace at `/admin` already lists upcoming organization tournaments and supports organization and staff management. Convex already has tournament setup functions, including `createTournament` and `configureSwissPhase`, but those operations are separate. That means a tournament can be created without a phase if a later call fails.

The new creation flow should make the tournament-plus-phases invariant explicit. It should not add tournament edit/manage screens yet.

## Backend Design

Add a Convex mutation that creates a tournament and its phases in one transaction. The mutation should validate the organizer's active organization membership, insert a private tournament draft, and insert one or more Swiss phases before returning.

The mutation should accept:

- `organizationId`
- `name`
- `startDate`
- `playerCapacity`
- `phases`

Each phase should be Swiss. Since Swiss is the only supported phase type right now, the client does not need a phase type picker. The backend should still validate that each submitted phase is Swiss or omit phase type from the public input and assign Swiss server-side.

The phases input should support dynamic and fixed round counts:

- Dynamic rounds are the default and do not store a fixed total at creation.
- Fixed rounds require a valid positive round count.

The `tournamentPhases` schema currently requires `phaseTotalRounds: number`. To support dynamic rounds, add an explicit round mode field, `phaseRoundMode: "dynamic" | "fixed"`, and change `phaseTotalRounds` to `v.union(v.number(), v.null())`. Dynamic phases store `phaseTotalRounds: null`. Existing phase logic that needs a concrete round count should resolve the effective round count when the tournament starts, based on the active player count at that time.

## Organizer UI

Add a "Create tournament" form to the tournaments view of `OrganizerWorkspace`. The form should follow the existing admin UI style: compact operational layout, bordered white panel, standard inputs, and small icon buttons where useful.

The form fields are:

- Tournament name.
- Start date and time.
- Player capacity.
- Phases list.

The initial phase list should contain one Swiss phase with dynamic rounds. Organizers can add more Swiss phases during creation. A phase row should show its order and round setting:

- `Dynamic` is the default.
- `Fixed` shows a numeric rounds input.
- Removing a phase is available only when more than one phase exists.

On submit, the UI calls the new single creation mutation. On success, the form resets to one dynamic Swiss phase, a success notice appears, and the reactive tournament list shows the new private tournament. On failure, the existing form values remain and a concise error notice appears.

## Data Flow

The tournaments view already selects an organization and subscribes to `api.tournaments.listUpcomingForOrganization`. The creation form should use the selected organization ID. If no organization is selected, the form should be disabled or replaced with an empty state asking the user to create an organization first.

Successful creation should not require manual refetching because Convex subscriptions update automatically.

## Validation And Errors

Backend validation should enforce:

- The user is authenticated and has active membership in the organization.
- Tournament name is non-empty after trimming.
- Player capacity is within the existing valid capacity rules.
- At least one phase is provided.
- Every phase is Swiss.
- Dynamic phases do not require a round count.
- Fixed phases require a valid round count.

Client validation should keep the form pleasant but not be trusted for authorization or invariants. Use required inputs, numeric min values, disabled submit state while creating, and clear text notices for mutation failures.

## Testing

Follow test-first implementation:

- Add a Convex test that verifies the new creation mutation inserts a tournament and one default dynamic Swiss phase.
- Add a Convex test that verifies multiple submitted Swiss phases are inserted in order.
- Add a Convex test that verifies creation rejects an empty phase list.
- Add a lightweight frontend/unit test if the existing test setup can exercise the phase form helpers without adding new libraries. If not, keep UI verification to lint, build, and browser inspection.

Verification should include:

- `pnpm exec vitest run convex/tournaments.convex.spec.ts`
- `pnpm run lint`
- `pnpm run build`

## Non-Goals

This change does not add tournament edit screens, manage pages, registration operations, advancement criteria, non-Swiss phase types, payment, or bracket/elimination support.
