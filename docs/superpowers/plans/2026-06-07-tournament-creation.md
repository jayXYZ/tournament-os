# Tournament Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tournament creation to the organizer workspace, creating a private tournament draft with at least one Swiss phase in the same Convex mutation.

**Architecture:** Store phase round intent with `phaseRoundMode: "dynamic" | "fixed"` and nullable `phaseTotalRounds`. Add a transactional Convex mutation that creates the tournament and all submitted Swiss phases, then wire `/admin` to a compact creation form backed by pure form helpers. Resolve dynamic Swiss round counts at tournament start from the active player count.

**Tech Stack:** Next.js 16 App Router, React 19 Client Components, Convex, WorkOS AuthKit, Tailwind CSS, Vitest with `convex-test`, Node test runner for local utility tests.

---

## File Structure

- Modify `convex/validators.ts`: add the phase round mode validator.
- Modify `convex/schema.ts`: add `phaseRoundMode` and make `phaseTotalRounds` nullable on `tournamentPhases`.
- Modify `convex/tournaments.ts`: add `createTournamentWithPhases`, preserve `createTournament` by creating one default dynamic Swiss phase, update all phase inserts, and resolve dynamic rounds when a tournament starts.
- Modify `convex/tournaments.convex.spec.ts`: add behavior tests for tournament creation with phases and dynamic round resolution.
- Modify `convex/tournaments.test.ts`: update source-level coverage for the new exported mutation and schema fields.
- Create `lib/tournament-creation-utils.ts`: pure helpers for phase form rows and mutation payload shaping.
- Create `lib/tournament-creation-utils.test.ts`: Node tests for form helper behavior.
- Modify `app/components/organizer-workspace.tsx`: add the creation form to the tournaments view and call the new mutation.

## Task 1: Convex Creation Tests

**Files:**
- Modify: `convex/tournaments.convex.spec.ts`

- [ ] **Step 1: Add failing behavior tests**

Add these tests after the `listUpcomingForOrganization returns active future tournaments for one organization` test:

```ts
test("createTournamentWithPhases creates a private tournament with one dynamic Swiss phase", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);

  const tournamentId = await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.createTournamentWithPhases, {
      organizationId,
      name: "Store Championship",
      startDate: now + 86_400_000,
      playerCapacity: 32,
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    });

  const setup = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.getTournamentSetup, { tournamentId });

  expect(setup.tournament.name).toBe("Store Championship");
  expect(setup.tournament.status).toBe("private");
  expect(setup.phases).toHaveLength(1);
  expect(setup.phases[0].phaseType).toBe("swiss");
  expect(setup.phases[0].phaseOrder).toBe(1);
  expect(setup.phases[0].phaseRoundMode).toBe("dynamic");
  expect(setup.phases[0].phaseTotalRounds).toBeNull();
});

test("createTournamentWithPhases stores multiple Swiss phases in order", async () => {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const { organizationId } = await seedOrganizer(t);

  const tournamentId = await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.createTournamentWithPhases, {
      organizationId,
      name: "Regional Trial",
      startDate: now + 86_400_000,
      playerCapacity: 64,
      phases: [
        { phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 6 },
        { phaseOrder: 2, phaseRoundMode: "dynamic" },
      ],
    });

  const setup = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.getTournamentSetup, { tournamentId });

  expect(setup.phases.map((phase) => phase.phaseOrder)).toEqual([1, 2]);
  expect(setup.phases.map((phase) => phase.phaseRoundMode)).toEqual([
    "fixed",
    "dynamic",
  ]);
  expect(setup.phases.map((phase) => phase.phaseTotalRounds)).toEqual([6, null]);
});

test("createTournamentWithPhases rejects an empty phase list", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);

  await expect(
    t.withIdentity(organizerIdentity).mutation(
      api.tournaments.createTournamentWithPhases,
      {
        organizationId,
        name: "No Phase Event",
        startDate: Date.now() + 86_400_000,
        playerCapacity: 16,
        phases: [],
      },
    ),
  ).rejects.toThrow("At least one Swiss phase is required");
});

test("startTournament resolves dynamic Swiss rounds from active player count", async () => {
  const t = convexTest(schema, modules);
  const { organizationId } = await seedOrganizer(t);
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
    api.tournaments.createTournamentWithPhases,
    {
      organizationId,
      name: "Dynamic Round Event",
      startDate: Date.now(),
      playerCapacity: 16,
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await seedActiveRegistrations(t, tournamentId, 5);

  await authed.mutation(api.tournaments.startTournament, { tournamentId });
  const setup = await authed.query(api.tournaments.getTournamentSetup, {
    tournamentId,
  });

  expect(setup.phases[0].phaseRoundMode).toBe("dynamic");
  expect(setup.phases[0].phaseTotalRounds).toBe(3);
});
```

Add this helper below `seedOrganizer`:

```ts
async function seedActiveRegistrations(
  t: ReturnType<typeof convexTest>,
  tournamentId: Id<"tournaments">,
  count: number,
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let playerNumber = 1; playerNumber <= count; playerNumber += 1) {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: `player:${playerNumber}`,
        workosUserId: `player:${playerNumber}`,
        email: `player${playerNumber}@example.test`,
        name: `Player ${playerNumber}`,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        userId,
        status: "active",
        createdAt: now + playerNumber,
        updatedAt: now,
      });
    }
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run convex/tournaments.convex.spec.ts`

Expected: FAIL because `api.tournaments.createTournamentWithPhases` is not defined and `phaseRoundMode` is not in the schema.

## Task 2: Convex Schema And Mutation

**Files:**
- Modify: `convex/validators.ts`
- Modify: `convex/schema.ts`
- Modify: `convex/tournaments.ts`
- Modify: `convex/tournaments.test.ts`

- [ ] **Step 1: Add round mode validator**

In `convex/validators.ts`, add:

```ts
export const tournamentPhaseRoundModeValidator = v.union(
  v.literal("dynamic"),
  v.literal("fixed"),
);
```

- [ ] **Step 2: Update tournament phase schema**

In `convex/schema.ts`, import `tournamentPhaseRoundModeValidator` and change the `tournamentPhases` fields to:

```ts
tournamentPhases: defineTable({
  tournamentId: v.id("tournaments"),
  phaseType: v.string(),
  phaseOrder: v.number(),
  phaseStatus: tournamentPhaseStatusValidator,
  phaseRoundMode: tournamentPhaseRoundModeValidator,
  phaseTotalRounds: v.union(v.number(), v.null()),
  phaseCurrentRound: v.optional(v.id("tournamentRounds")),
  phaseCutoff: v.union(
    v.literal("top_X_players"),
    v.literal("X_points_or_more"),
    v.null(),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
```

- [ ] **Step 3: Add phase input types and helper functions**

In `convex/tournaments.ts`, import `tournamentPhaseRoundModeValidator` from `./validators` and add these types near the existing type declarations:

```ts
type PhaseRoundMode = "dynamic" | "fixed";
type TournamentPhaseInput = {
  phaseOrder: number;
  phaseRoundMode: PhaseRoundMode;
  phaseTotalRounds?: number;
};
```

Add these helpers near `validRoundCount`:

```ts
function validPhaseInputs(phases: TournamentPhaseInput[]) {
  if (phases.length < 1) {
    throw new Error("At least one Swiss phase is required");
  }
  if (phases.length > 16) {
    throw new Error("A tournament can have at most 16 phases");
  }

  return phases.map((phase, index) => {
    const expectedOrder = index + 1;
    if (Math.trunc(phase.phaseOrder) !== expectedOrder) {
      throw new Error("Swiss phases must be ordered starting at 1");
    }
    if (phase.phaseRoundMode === "dynamic") {
      return {
        phaseOrder: expectedOrder,
        phaseRoundMode: "dynamic" as const,
        phaseTotalRounds: null,
      };
    }

    return {
      phaseOrder: expectedOrder,
      phaseRoundMode: "fixed" as const,
      phaseTotalRounds: validRoundCount(phase.phaseTotalRounds ?? 0),
    };
  });
}

async function createSwissPhases(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  phases: ReturnType<typeof validPhaseInputs>,
  now: number,
) {
  for (const phase of phases) {
    await ctx.db.insert("tournamentPhases", {
      tournamentId,
      phaseType: SWISS_FORMAT,
      phaseOrder: phase.phaseOrder,
      phaseStatus: "upcoming",
      phaseRoundMode: phase.phaseRoundMode,
      phaseTotalRounds: phase.phaseTotalRounds,
      phaseCutoff: null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function resolvePhaseTotalRounds(
  ctx: MutationCtx,
  phase: Doc<"tournamentPhases">,
  activePlayerCount: number,
) {
  if (phase.phaseRoundMode === "fixed") {
    if (phase.phaseTotalRounds === null) {
      throw new Error("Fixed Swiss phase is missing a round count");
    }
    return phase.phaseTotalRounds;
  }

  const phaseTotalRounds = validRoundCount(defaultSwissRoundCount(activePlayerCount));
  if (phase.phaseTotalRounds !== phaseTotalRounds) {
    await ctx.db.patch(phase._id, {
      phaseTotalRounds,
      updatedAt: Date.now(),
    });
  }
  return phaseTotalRounds;
}

function requireResolvedPhaseTotalRounds(phase: Doc<"tournamentPhases">) {
  if (phase.phaseTotalRounds === null) {
    throw new Error("Swiss phase round count is not resolved");
  }
  return phase.phaseTotalRounds;
}
```

- [ ] **Step 4: Add shared creation helper and transactional mutation**

Replace the existing `createTournament` implementation with the shared helper pattern below, then add `createTournamentWithPhases` after `createTournament`.

```ts
export const createTournamentWithPhases = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    startDate: v.number(),
    playerCapacity: v.number(),
    phases: v.array(
      v.object({
        phaseOrder: v.number(),
        phaseRoundMode: tournamentPhaseRoundModeValidator,
        phaseTotalRounds: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Id<"tournaments">> => {
    return await createTournamentInternal(ctx, {
      organizationId: args.organizationId,
      name: args.name,
      startDate: args.startDate,
      playerCapacity: args.playerCapacity,
      isTestEvent: false,
      phases: validPhaseInputs(args.phases),
    });
  },
});
```

Add this helper after the mutation exports:

```ts
async function createTournamentInternal(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    name: string;
    startDate: number;
    playerCapacity: number;
    isTestEvent: boolean;
    phases: ReturnType<typeof validPhaseInputs>;
  },
) {
  const { user } = await requireOrganizationMembership(ctx, args.organizationId);
  const now = Date.now();
  const tournamentId = await ctx.db.insert("tournaments", {
    name: cleanName(args.name, "Tournament name"),
    organizationId: args.organizationId,
    createdBy: user._id,
    status: "private",
    startDate: args.startDate,
    playerCapacity: validCapacity(args.playerCapacity),
    format: SWISS_FORMAT,
    isTestEvent: args.isTestEvent,
    createdAt: now,
    updatedAt: now,
  });

  await createSwissPhases(ctx, tournamentId, args.phases, now);
  return tournamentId;
}
```

Update existing `createTournament` to call the helper:

```ts
export const createTournament = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    startDate: v.number(),
    playerCapacity: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"tournaments">> => {
    return await createTournamentInternal(ctx, {
      organizationId: args.organizationId,
      name: args.name,
      startDate: args.startDate,
      playerCapacity: args.playerCapacity,
      isTestEvent: false,
      phases: validPhaseInputs([
        { phaseOrder: 1, phaseRoundMode: "dynamic" },
      ]),
    });
  },
});
```

- [ ] **Step 5: Update all existing phase inserts**

Set `phaseRoundMode: "fixed"` on phase inserts in `configureSwissPhase`, `createTestTournament`, and `resetTestTournament`. Keep existing numeric `phaseTotalRounds` values in those paths.

In `configureSwissPhase`, when patching an existing phase, patch both fields:

```ts
phaseRoundMode: "fixed",
phaseTotalRounds,
```

- [ ] **Step 6: Resolve dynamic rounds at tournament start**

In `startTournament`, after loading active registrations and before `createRoundWithPairings`, add:

```ts
const phaseTotalRounds = await resolvePhaseTotalRounds(
  ctx,
  phase,
  registrations.length,
);
const playablePhase = { ...phase, phaseTotalRounds };
```

Pass `playablePhase` to `createRoundWithPairings` and patch `playablePhase._id` when starting the phase:

```ts
phase: playablePhase,
```

```ts
await ctx.db.patch(playablePhase._id, {
  phaseStatus: "in_progress",
  phaseCurrentRound: roundId,
  updatedAt: now,
});
```

Update later round-limit checks so nullable schema types are narrowed before numeric comparisons:

```ts
const phaseTotalRounds = requireResolvedPhaseTotalRounds(phase);
if (currentRound.roundNumber >= phaseTotalRounds) {
  throw new Error("All configured rounds have been generated");
}
```

Use the same helper in `completeRound`:

```ts
const phaseTotalRounds = requireResolvedPhaseTotalRounds(phase);
if (round.roundNumber >= phaseTotalRounds) {
  await ctx.db.patch(phase._id, {
    phaseStatus: "completed",
    updatedAt: now,
  });
}
```

Use the same helper in `advanceTestRound`:

```ts
const finalRound = Math.min(
  config.roundsToGenerate,
  requireResolvedPhaseTotalRounds(phase),
);
```

- [ ] **Step 7: Update source-level test**

In `convex/tournaments.test.ts`, add source assertions:

```ts
assert.match(schemaSource, /phaseRoundMode: tournamentPhaseRoundModeValidator/);
assert.match(
  schemaSource,
  /phaseTotalRounds: v\.union\(v\.number\(\), v\.null\(\)\)/,
);
```

Add `"createTournamentWithPhases"` to the exported function list.

- [ ] **Step 8: Run backend tests to verify they pass**

Run: `pnpm exec vitest run convex/tournaments.convex.spec.ts`

Expected: PASS.

Run: `node --test convex/tournaments.test.ts`

Expected: PASS.

## Task 3: Tournament Creation Form Helpers

**Files:**
- Create: `lib/tournament-creation-utils.ts`
- Create: `lib/tournament-creation-utils.test.ts`

- [ ] **Step 1: Write failing utility tests**

Create `lib/tournament-creation-utils.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  addTournamentCreationPhase,
  createDefaultTournamentCreationPhase,
  removeTournamentCreationPhase,
  toTournamentCreationPhasePayload,
} from "./tournament-creation-utils.ts";

test("createDefaultTournamentCreationPhase creates a dynamic Swiss phase", () => {
  assert.deepEqual(createDefaultTournamentCreationPhase("phase-1"), {
    id: "phase-1",
    phaseRoundMode: "dynamic",
    phaseTotalRounds: "3",
  });
});

test("addTournamentCreationPhase appends a dynamic phase", () => {
  const phases = [createDefaultTournamentCreationPhase("phase-1")];

  assert.deepEqual(addTournamentCreationPhase(phases, "phase-2"), [
    createDefaultTournamentCreationPhase("phase-1"),
    createDefaultTournamentCreationPhase("phase-2"),
  ]);
});

test("removeTournamentCreationPhase keeps one required phase", () => {
  const onlyPhase = [createDefaultTournamentCreationPhase("phase-1")];
  const twoPhases = addTournamentCreationPhase(onlyPhase, "phase-2");

  assert.deepEqual(removeTournamentCreationPhase(onlyPhase, "phase-1"), onlyPhase);
  assert.deepEqual(removeTournamentCreationPhase(twoPhases, "phase-1"), [
    createDefaultTournamentCreationPhase("phase-2"),
  ]);
});

test("toTournamentCreationPhasePayload sends contiguous phase orders", () => {
  const phases = [
    createDefaultTournamentCreationPhase("phase-1"),
    {
      id: "phase-2",
      phaseRoundMode: "fixed" as const,
      phaseTotalRounds: "5",
    },
  ];

  assert.deepEqual(toTournamentCreationPhasePayload(phases), [
    { phaseOrder: 1, phaseRoundMode: "dynamic" },
    { phaseOrder: 2, phaseRoundMode: "fixed", phaseTotalRounds: 5 },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/tournament-creation-utils.test.ts`

Expected: FAIL because `lib/tournament-creation-utils.ts` does not exist.

- [ ] **Step 3: Add utility implementation**

Create `lib/tournament-creation-utils.ts`:

```ts
export type TournamentCreationPhaseRoundMode = "dynamic" | "fixed";

export type TournamentCreationPhaseForm = {
  id: string;
  phaseRoundMode: TournamentCreationPhaseRoundMode;
  phaseTotalRounds: string;
};

export type TournamentCreationPhasePayload = {
  phaseOrder: number;
  phaseRoundMode: TournamentCreationPhaseRoundMode;
  phaseTotalRounds?: number;
};

export function createDefaultTournamentCreationPhase(
  id: string,
): TournamentCreationPhaseForm {
  return {
    id,
    phaseRoundMode: "dynamic",
    phaseTotalRounds: "3",
  };
}

export function addTournamentCreationPhase(
  phases: TournamentCreationPhaseForm[],
  id: string,
) {
  return [...phases, createDefaultTournamentCreationPhase(id)];
}

export function removeTournamentCreationPhase(
  phases: TournamentCreationPhaseForm[],
  id: string,
) {
  if (phases.length <= 1) {
    return phases;
  }
  return phases.filter((phase) => phase.id !== id);
}

export function toTournamentCreationPhasePayload(
  phases: TournamentCreationPhaseForm[],
): TournamentCreationPhasePayload[] {
  return phases.map((phase, index) => {
    const phaseOrder = index + 1;
    if (phase.phaseRoundMode === "dynamic") {
      return { phaseOrder, phaseRoundMode: "dynamic" };
    }

    return {
      phaseOrder,
      phaseRoundMode: "fixed",
      phaseTotalRounds: Number.parseInt(phase.phaseTotalRounds, 10),
    };
  });
}
```

- [ ] **Step 4: Run utility tests to verify they pass**

Run: `node --test lib/tournament-creation-utils.test.ts`

Expected: PASS.

## Task 4: Organizer Creation UI

**Files:**
- Modify: `app/components/organizer-workspace.tsx`

- [ ] **Step 1: Add imports and state**

Add `Plus`, `Trash2`, and `Sparkles` from `lucide-react`. Import helper functions and types from `@/lib/tournament-creation-utils`.

Extend busy state:

```ts
type BusyState = "org" | "invite" | "tournament" | null;
const [busy, setBusy] = useState<BusyState>(null);
```

Change every component prop type that currently accepts `"org" | "invite" | null` for `busy` to use `BusyState`.

Add the mutation and form state:

```ts
const createTournament = useMutation(api.tournaments.createTournamentWithPhases);
const [tournamentName, setTournamentName] = useState("");
const [tournamentStartDateTime, setTournamentStartDateTime] = useState("");
const [tournamentPlayerCapacity, setTournamentPlayerCapacity] = useState("32");
const [tournamentPhases, setTournamentPhases] = useState<
  TournamentCreationPhaseForm[]
>([createDefaultTournamentCreationPhase("phase-1")]);
```

- [ ] **Step 2: Add submit and phase handlers**

Inside `OrganizerWorkspace`, add:

```ts
async function handleCreateTournament(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!selectedOrganizationId) {
    return;
  }

  setBusy("tournament");
  setNotice(null);
  try {
    await createTournament({
      organizationId: selectedOrganizationId,
      name: tournamentName,
      startDate: new Date(tournamentStartDateTime).getTime(),
      playerCapacity: Number.parseInt(tournamentPlayerCapacity, 10),
      phases: toTournamentCreationPhasePayload(tournamentPhases),
    });
    setTournamentName("");
    setTournamentStartDateTime("");
    setTournamentPlayerCapacity("32");
    setTournamentPhases([createDefaultTournamentCreationPhase("phase-1")]);
    setNotice("Tournament created.");
  } catch (error) {
    setNotice(
      error instanceof Error
        ? error.message
        : "Could not create tournament.",
    );
  } finally {
    setBusy(null);
  }
}

function handleAddTournamentPhase() {
  setTournamentPhases((current) =>
    addTournamentCreationPhase(current, `phase-${Date.now()}`),
  );
}

function handleRemoveTournamentPhase(id: string) {
  setTournamentPhases((current) =>
    removeTournamentCreationPhase(current, id),
  );
}
```

Use inline state updates for changing a phase row:

```ts
setTournamentPhases((current) =>
  current.map((phase) =>
    phase.id === id ? { ...phase, phaseRoundMode: value } : phase,
  ),
)
```

- [ ] **Step 3: Pass creation props into `TournamentAdminView`**

Extend `TournamentAdminView` props with:

```ts
busy: BusyState;
onCreateTournament: (event: FormEvent<HTMLFormElement>) => void;
onAddTournamentPhase: () => void;
onRemoveTournamentPhase: (id: string) => void;
onTournamentNameChange: (value: string) => void;
onTournamentStartDateTimeChange: (value: string) => void;
onTournamentPlayerCapacityChange: (value: string) => void;
onTournamentPhasesChange: (phases: TournamentCreationPhaseForm[]) => void;
selectedOrganizationId: Id<"organizations"> | null;
tournamentName: string;
tournamentStartDateTime: string;
tournamentPlayerCapacity: string;
tournamentPhases: TournamentCreationPhaseForm[];
```

Pass those props from the `TournamentAdminView` call.

- [ ] **Step 4: Add `CreateTournamentForm` component**

Add a component before `TournamentTable`:

```tsx
function CreateTournamentForm({
  busy,
  onAddTournamentPhase,
  onCreateTournament,
  onRemoveTournamentPhase,
  onTournamentNameChange,
  onTournamentPhasesChange,
  onTournamentPlayerCapacityChange,
  onTournamentStartDateTimeChange,
  selectedOrganizationId,
  tournamentName,
  tournamentPhases,
  tournamentPlayerCapacity,
  tournamentStartDateTime,
}: {
  busy: BusyState;
  onAddTournamentPhase: () => void;
  onCreateTournament: (event: FormEvent<HTMLFormElement>) => void;
  onRemoveTournamentPhase: (id: string) => void;
  onTournamentNameChange: (value: string) => void;
  onTournamentPhasesChange: (phases: TournamentCreationPhaseForm[]) => void;
  onTournamentPlayerCapacityChange: (value: string) => void;
  onTournamentStartDateTimeChange: (value: string) => void;
  selectedOrganizationId: Id<"organizations"> | null;
  tournamentName: string;
  tournamentPhases: TournamentCreationPhaseForm[];
  tournamentPlayerCapacity: string;
  tournamentStartDateTime: string;
}) {
  const disabled = !selectedOrganizationId || busy === "tournament";

  return (
    <form
      onSubmit={onCreateTournament}
      className="rounded-md border border-stone-200 bg-white p-4"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-emerald-700" />
          <h2 className="text-sm font-semibold">Create tournament</h2>
        </div>
        <Button type="submit" disabled={disabled} className="h-9 bg-emerald-700 text-white hover:bg-emerald-800">
          Create
        </Button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_1fr_140px]">
        <input
          value={tournamentName}
          onChange={(event) => onTournamentNameChange(event.target.value)}
          className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
          placeholder="Store Championship"
          disabled={disabled}
          required
        />
        <input
          value={tournamentStartDateTime}
          onChange={(event) => onTournamentStartDateTimeChange(event.target.value)}
          className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
          type="datetime-local"
          disabled={disabled}
          required
        />
        <input
          value={tournamentPlayerCapacity}
          onChange={(event) => onTournamentPlayerCapacityChange(event.target.value)}
          className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
          type="number"
          min={2}
          max={512}
          disabled={disabled}
          required
        />
      </div>
      <div className="mt-4 grid gap-2">
        {tournamentPhases.map((phase, index) => (
          <div
            key={phase.id}
            className="grid gap-2 rounded-md border border-stone-200 bg-stone-50 p-3 md:grid-cols-[90px_1fr_120px_40px]"
          >
            <span className="flex h-10 items-center text-sm font-medium">
              Phase {index + 1}
            </span>
            <select
              value={phase.phaseRoundMode}
              onChange={(event) =>
                onTournamentPhasesChange(
                  tournamentPhases.map((current) =>
                    current.id === phase.id
                      ? {
                          ...current,
                          phaseRoundMode: event.target.value as TournamentCreationPhaseRoundMode,
                        }
                      : current,
                  ),
                )
              }
              className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20"
              disabled={disabled}
            >
              <option value="dynamic">Dynamic rounds</option>
              <option value="fixed">Fixed rounds</option>
            </select>
            <input
              value={phase.phaseTotalRounds}
              onChange={(event) =>
                onTournamentPhasesChange(
                  tournamentPhases.map((current) =>
                    current.id === phase.id
                      ? { ...current, phaseTotalRounds: event.target.value }
                      : current,
                  ),
                )
              }
              className="h-10 rounded-md border border-stone-300 px-3 text-sm outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20 disabled:bg-stone-100 disabled:text-stone-400"
              type="number"
              min={1}
              max={16}
              disabled={disabled || phase.phaseRoundMode === "dynamic"}
              required={phase.phaseRoundMode === "fixed"}
            />
            <Button
              type="button"
              variant="outline"
              className="h-10 px-0"
              onClick={() => onRemoveTournamentPhase(phase.id)}
              disabled={disabled || tournamentPhases.length === 1}
              aria-label={`Remove phase ${index + 1}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={onAddTournamentPhase}
        disabled={disabled}
        className="mt-3 h-9"
      >
        <Plus className="size-4" />
        Add Swiss phase
      </Button>
      {!selectedOrganizationId && (
        <p className="mt-3 text-xs leading-5 text-stone-500">
          Create or select an organization before creating tournaments.
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 5: Render the form in tournaments view**

In `TournamentAdminView`, render `CreateTournamentForm` between the metrics and the tournaments table.

- [ ] **Step 6: Run lint**

Run: `pnpm run lint`

Expected: PASS.

## Task 5: Final Verification

**Files:**
- Review all changed files.

- [ ] **Step 1: Run focused tests**

Run: `pnpm exec vitest run convex/tournaments.convex.spec.ts`

Expected: PASS.

Run: `node --test convex/tournaments.test.ts lib/tournament-creation-utils.test.ts`

Expected: PASS.

- [ ] **Step 2: Run app checks**

Run: `pnpm run lint`

Expected: PASS.

Run: `pnpm run build`

Expected: PASS.

- [ ] **Step 3: Inspect diff**

Run: `git diff -- app/components/organizer-workspace.tsx convex lib docs/superpowers/plans/2026-06-07-tournament-creation.md`

Expected: diff contains only the tournament creation backend, form helpers, organizer UI, tests, and this plan.
