/// <reference types="vite/client" />
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  organizerIdentity,
  playerIdentity,
  seedOrganizer,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";
import type { TestConvex } from "convex-test";
import type schema from "./schema";

// The convention entity and its parent-child hierarchy: lifecycle
// transitions, public/managed reads, attach/detach rules, and the
// cancellation/deletion behavior TODO §4 pins (children are never silently
// changed; delete detaches, never deletes, child events).

const START = Date.UTC(2027, 7, 6, 16, 0, 0);
const END = Date.UTC(2027, 7, 8, 23, 0, 0);

async function seedConvention(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
  overrides?: { publish?: boolean; isTestEvent?: boolean },
) {
  const organizer = t.withIdentity(organizerIdentity);
  const conventionId: Id<"conventions"> = await organizer.mutation(
    api.conventions.lifecycle.createConvention,
    {
      organizationId,
      name: "Winter Gathering",
      startDate: START,
      endDate: END,
      playerCapacity: 100,
      isTestEvent: overrides?.isTestEvent ?? false,
    },
  );
  if (overrides?.publish !== false) {
    await organizer.mutation(api.conventions.lifecycle.publishConvention, {
      conventionId,
    });
  }
  return conventionId;
}

async function seedStandaloneTournament(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
  name = "Side Event",
) {
  const organizer = t.withIdentity(organizerIdentity);
  return await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name,
      startDate: START,
      playerCapacity: 8,
      format: "modern",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
}

test("a convention is created in setup with its own public code and publishes into registration", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const conventionId = await seedConvention(t, organizationId, {
    publish: false,
  });

  const convention = await t.run(async (ctx) => ctx.db.get(conventionId));
  expect(convention).toMatchObject({
    lifecycle: "setup",
    visibility: "public",
    publicCode: 100_001,
    confirmedRegistrationCount: 0,
    badgeRequiredForChildEvents: false,
  });

  // Hidden from the public while in setup, even by code.
  expect(
    await t.query(api.conventions.lifecycle.getPublicConvention, {
      publicCode: "100001",
    }),
  ).toBeNull();

  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.conventions.lifecycle.publishConvention, {
    conventionId,
  });
  const published = await t.query(
    api.conventions.lifecycle.getPublicConvention,
    { publicCode: "100001" },
  );
  expect(published?.convention.lifecycle).toBe("registration");
  expect(published?.organizationName).toBe("Test Org");
});

test("the date range must not invert, at creation and on edit", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  await expect(
    organizer.mutation(api.conventions.lifecycle.createConvention, {
      organizationId,
      name: "Backwards Con",
      startDate: END,
      endDate: START,
      playerCapacity: 10,
    }),
  ).rejects.toThrow(/end date/i);

  const conventionId = await seedConvention(t, organizationId);
  await expect(
    organizer.mutation(api.conventions.lifecycle.updateConventionSetup, {
      conventionId,
      endDate: START - 1,
    }),
  ).rejects.toThrow(/end date/i);
});

test("attach and detach link a same-org tournament and audit both directions", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const conventionId = await seedConvention(t, organizationId);
  const tournamentId = await seedStandaloneTournament(t, organizationId);
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.conventions.events.attachTournament, {
    conventionId,
    tournamentId,
  });
  expect(
    (await t.run(async (ctx) => ctx.db.get(tournamentId)))?.conventionId,
  ).toBe(conventionId);

  const children = await organizer.query(
    api.conventions.events.listChildEvents,
    { conventionId, paginationOpts: { numItems: 50, cursor: null } },
  );
  expect(children.page.map((child) => child._id)).toEqual([tournamentId]);

  // Attached tournaments leave the attachable pool.
  expect(
    await organizer.query(api.conventions.events.listAttachableTournaments, {
      conventionId,
    }),
  ).toEqual([]);

  await organizer.mutation(api.conventions.events.detachTournament, {
    conventionId,
    tournamentId,
  });
  expect(
    (await t.run(async (ctx) => ctx.db.get(tournamentId)))?.conventionId,
  ).toBeUndefined();

  const log = await organizer.query(api.conventions.auditLog.listAuditEvents, {
    conventionId,
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(log.page.map((row) => row.event.type)).toEqual([
    "tournament_detached",
    "tournament_attached",
    "convention_published",
  ]);
});

test("attach refuses another convention's child and started events; detach refuses started events", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const conventionId = await seedConvention(t, organizationId);
  const otherConventionId = await seedConvention(t, organizationId);
  const tournamentId = await seedStandaloneTournament(t, organizationId);
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.conventions.events.attachTournament, {
    conventionId,
    tournamentId,
  });
  await expect(
    organizer.mutation(api.conventions.events.attachTournament, {
      conventionId: otherConventionId,
      tournamentId,
    }),
  ).rejects.toThrow(/already part of another convention/);

  // A started child keeps its association: no detach, no move.
  await t.run(async (ctx) => {
    await ctx.db.patch(tournamentId, {
      lifecycle: "in_progress",
      updatedAt: Date.now(),
    });
  });
  await expect(
    organizer.mutation(api.conventions.events.detachTournament, {
      conventionId,
      tournamentId,
    }),
  ).rejects.toThrow(/keep their convention history/);

  const standalone = await seedStandaloneTournament(
    t,
    organizationId,
    "Started Standalone",
  );
  await t.run(async (ctx) => {
    await ctx.db.patch(standalone, {
      lifecycle: "in_progress",
      updatedAt: Date.now(),
    });
  });
  await expect(
    organizer.mutation(api.conventions.events.attachTournament, {
      conventionId,
      tournamentId: standalone,
    }),
  ).rejects.toThrow(/not started/);
});

test("createTournamentForConvention creates an attached child in the convention's org, inheriting the test flag", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const conventionId = await seedConvention(t, organizationId, {
    isTestEvent: true,
  });
  const organizer = t.withIdentity(organizerIdentity);

  const tournamentId = await organizer.mutation(
    api.conventions.events.createTournamentForConvention,
    {
      conventionId,
      name: "Main Event",
      startDate: START,
      playerCapacity: 32,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  const tournament = await t.run(async (ctx) => ctx.db.get(tournamentId));
  expect(tournament).toMatchObject({
    conventionId,
    organizationId,
    isTestEvent: true,
    lifecycle: "setup",
  });
});

test("cancelling a convention leaves its children attached and untouched", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const conventionId = await seedConvention(t, organizationId);
  const tournamentId = await seedStandaloneTournament(t, organizationId);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.conventions.events.attachTournament, {
    conventionId,
    tournamentId,
  });
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });

  await organizer.mutation(api.conventions.lifecycle.cancelConvention, {
    conventionId,
  });

  expect(
    (await t.run(async (ctx) => ctx.db.get(conventionId)))?.lifecycle,
  ).toBe("cancelled");
  const child = await t.run(async (ctx) => ctx.db.get(tournamentId));
  expect(child?.lifecycle).toBe("registration");
  expect(child?.conventionId).toBe(conventionId);
});

test("deleting a convention detaches children, preserves them, and removes the convention's own rows", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const conventionId = await seedConvention(t, organizationId);
  const tournamentId = await seedStandaloneTournament(t, organizationId);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.conventions.events.attachTournament, {
    conventionId,
    tournamentId,
  });

  // Small conventions clear within the delete mutation itself (the batched
  // continuation only kicks in past the write budget), so nothing is left
  // on the scheduler to flush.
  await organizer.mutation(api.conventions.lifecycle.deleteConvention, {
    conventionId,
  });

  expect(await t.run(async (ctx) => ctx.db.get(conventionId))).toBeNull();
  const survivor = await t.run(async (ctx) => ctx.db.get(tournamentId));
  expect(survivor).not.toBeNull();
  expect(survivor?.conventionId).toBeUndefined();
  const auditRows = await t.run(async (ctx) =>
    ctx.db
      .query("conventionAuditEvents")
      .withIndex("by_conventionId", (q) => q.eq("conventionId", conventionId))
      .take(8),
  );
  expect(auditRows).toEqual([]);
});

test("completing a convention is an explicit organizer transition", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const conventionId = await seedConvention(t, organizationId);
  const organizer = t.withIdentity(organizerIdentity);

  // No in_progress phase (ADR 0004): "registration" runs straight to the
  // explicit completion.
  expect(
    (await t.run(async (ctx) => ctx.db.get(conventionId)))?.lifecycle,
  ).toBe("registration");

  await organizer.mutation(api.conventions.lifecycle.completeConvention, {
    conventionId,
  });
  expect(
    (await t.run(async (ctx) => ctx.db.get(conventionId)))?.lifecycle,
  ).toBe("completed");

  // Completed is terminal for these transitions.
  await expect(
    organizer.mutation(api.conventions.lifecycle.cancelConvention, {
      conventionId,
    }),
  ).rejects.toThrow(/cannot be cancelled/);
});

test("date edits cannot invalidate existing ticket-type windows", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const conventionId = await seedConvention(t, organizationId);
  const organizer = t.withIdentity(organizerIdentity);
  // A day pass for the final day.
  await organizer.mutation(api.conventions.ticketTypes.createTicketType, {
    conventionId,
    name: "Sunday pass",
    priceCents: 0,
    admissionStartDate: END - 2 * 60 * 60 * 1000,
    admissionEndDate: END,
  });

  // Shortening the convention out from under the pass's window is refused.
  await expect(
    organizer.mutation(api.conventions.lifecycle.updateConventionSetup, {
      conventionId,
      endDate: END - 24 * 60 * 60 * 1000,
    }),
  ).rejects.toThrow(/Sunday pass/);

  // An edit that still covers every window goes through.
  await organizer.mutation(api.conventions.lifecycle.updateConventionSetup, {
    conventionId,
    startDate: START + 60 * 60 * 1000,
  });
  expect(
    (await t.run(async (ctx) => ctx.db.get(conventionId)))?.startDate,
  ).toBe(START + 60 * 60 * 1000);
});

test("a private convention keeps its child-event list for the organizing team and badge holders", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const conventionId = await seedConvention(t, organizationId);
  const tournamentId = await seedStandaloneTournament(t, organizationId);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.conventions.events.attachTournament, {
    conventionId,
    tournamentId,
  });
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });

  // A badge holder registers while the convention is public, then it goes
  // private.
  const ticketTypes = await organizer.query(
    api.conventions.ticketTypes.listTicketTypesForOrganizer,
    { conventionId },
  );
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      tokenIdentifier: playerIdentity(1).tokenIdentifier,
      publicCode: 101,
      email: playerIdentity(1).email,
      name: playerIdentity(1).name,
      updatedAt: Date.now(),
    });
  });
  const holder = t.withIdentity(playerIdentity(1));
  await holder.mutation(
    api.conventions.registrations.registerSelfForConvention,
    { conventionId, ticketTypeId: ticketTypes[0]!._id },
  );
  await organizer.mutation(
    api.conventions.lifecycle.updateConventionVisibility,
    { conventionId, visibility: "private" },
  );

  const paginationOpts = { numItems: 50, cursor: null };
  // Anonymous viewers get nothing — but everyone the convention page itself
  // admits (canViewConvention) keeps its schedule.
  expect(
    (
      await t.query(api.conventions.events.listPublicChildEvents, {
        conventionId,
        paginationOpts,
      })
    ).page,
  ).toEqual([]);
  expect(
    (
      await organizer.query(api.conventions.events.listPublicChildEvents, {
        conventionId,
        paginationOpts,
      })
    ).page.map((child) => child._id),
  ).toEqual([tournamentId]);
  expect(
    (
      await holder.query(api.conventions.events.listPublicChildEvents, {
        conventionId,
        paginationOpts,
      })
    ).page.map((child) => child._id),
  ).toEqual([tournamentId]);
});

test("a private parent convention never leaks through its public child's page", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const conventionId = await seedConvention(t, organizationId);
  const tournamentId = await seedStandaloneTournament(t, organizationId);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.conventions.events.attachTournament, {
    conventionId,
    tournamentId,
  });
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  const publicCode = String(
    (await t.run(async (ctx) => ctx.db.get(tournamentId)))!.publicCode,
  );

  // Public parent: the child page names it.
  const before = await t.query(api.tournaments.lifecycle.getPublicTournament, {
    publicCode,
  });
  expect(before?.convention?.name).toBe("Winter Gathering");

  // Private parent: the child page stays up but the parent summary — its
  // name, code, and badge gate — must not leak to anonymous viewers.
  await organizer.mutation(
    api.conventions.lifecycle.updateConventionVisibility,
    {
      conventionId,
      visibility: "private",
    },
  );
  const anonymous = await t.query(
    api.tournaments.lifecycle.getPublicTournament,
    { publicCode },
  );
  expect(anonymous?.tournament._id).toBe(tournamentId);
  expect(anonymous?.convention).toBeNull();

  // The organizing team still sees it.
  const asOrganizer = await organizer.query(
    api.tournaments.lifecycle.getPublicTournament,
    { publicCode },
  );
  expect(asOrganizer?.convention?.name).toBe("Winter Gathering");
});
