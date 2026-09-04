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

// Free badge registration and the child-event badge gate: register/cancel
// round trips, capacity, private-convention admission, gating on
// registerSelf, and its non-retroactivity (cancelling a badge never revokes
// child registrations already made).

const START = Date.UTC(2027, 7, 6, 16, 0, 0);
const END = Date.UTC(2027, 7, 8, 23, 0, 0);

async function seedConvention(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
  overrides?: {
    playerCapacity?: number;
    visibility?: "public" | "unlisted" | "private";
    badgeRequired?: boolean;
  },
) {
  const organizer = t.withIdentity(organizerIdentity);
  const conventionId: Id<"conventions"> = await organizer.mutation(
    api.conventions.lifecycle.createConvention,
    {
      organizationId,
      name: "Winter Gathering",
      startDate: START,
      endDate: END,
      playerCapacity: overrides?.playerCapacity ?? 100,
    },
  );
  if (overrides?.badgeRequired) {
    await organizer.mutation(api.conventions.lifecycle.updateConventionSetup, {
      conventionId,
      badgeRequiredForChildEvents: true,
    });
  }
  if (overrides?.visibility) {
    await organizer.mutation(
      api.conventions.lifecycle.updateConventionVisibility,
      { conventionId, visibility: overrides.visibility },
    );
  }
  await organizer.mutation(api.conventions.lifecycle.publishConvention, {
    conventionId,
  });
  // The seeded free "General admission" pass (ADR 0004) is what these
  // free-registration tests register with.
  const ticketTypes = await organizer.query(
    api.conventions.ticketTypes.listTicketTypesForOrganizer,
    { conventionId },
  );
  return { conventionId, ticketTypeId: ticketTypes[0]!._id };
}

async function insertPlayerUser(t: TestConvex<typeof schema>, n: number) {
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      tokenIdentifier: playerIdentity(n).tokenIdentifier,
      publicCode: 100 + n,
      email: playerIdentity(n).email,
      name: playerIdentity(n).name,
      updatedAt: Date.now(),
    });
  });
}

test("free badge registration confirms directly, blocks duplicates, and round-trips through cancel", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedConvention(
    t,
    organizationId,
  );
  await insertPlayerUser(t, 1);
  const player = t.withIdentity(playerIdentity(1));

  const badgeId = await player.mutation(
    api.conventions.registrations.registerSelfForConvention,
    { conventionId, ticketTypeId },
  );
  const badge = await player.query(api.conventions.registrations.getMyBadge, {
    conventionId,
  });
  expect(badge?.entryStatus).toBe("confirmed");
  expect(
    (await t.run(async (ctx) => ctx.db.get(conventionId)))
      ?.confirmedRegistrationCount,
  ).toBe(1);

  await expect(
    player.mutation(api.conventions.registrations.registerSelfForConvention, {
      conventionId,
      ticketTypeId,
    }),
  ).rejects.toThrow(/Already registered/);

  await player.mutation(api.conventions.registrations.cancelMyBadge, {
    conventionId,
  });
  expect(
    (
      await player.query(api.conventions.registrations.getMyBadge, {
        conventionId,
      })
    )?.entryStatus,
  ).toBe("cancelled");
  expect(
    (await t.run(async (ctx) => ctx.db.get(conventionId)))
      ?.confirmedRegistrationCount,
  ).toBe(0);

  // Re-registering revives the same row rather than inserting a second one.
  const revivedId = await player.mutation(
    api.conventions.registrations.registerSelfForConvention,
    { conventionId, ticketTypeId },
  );
  expect(revivedId).toBe(badgeId);
});

test("badge capacity refuses registration when sold out", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedConvention(
    t,
    organizationId,
    { playerCapacity: 1 },
  );
  await insertPlayerUser(t, 1);
  await insertPlayerUser(t, 2);

  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.conventions.registrations.registerSelfForConvention, {
      conventionId,
      ticketTypeId,
    });
  await expect(
    t
      .withIdentity(playerIdentity(2))
      .mutation(api.conventions.registrations.registerSelfForConvention, {
        conventionId,
        ticketTypeId,
      }),
  ).rejects.toThrow(/sold out/);
});

test("a private convention admits no first-time registrant, but a cancelled badge re-admits", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedConvention(
    t,
    organizationId,
  );
  await insertPlayerUser(t, 1);
  await insertPlayerUser(t, 2);
  const returning = t.withIdentity(playerIdentity(1));
  await returning.mutation(
    api.conventions.registrations.registerSelfForConvention,
    { conventionId, ticketTypeId },
  );
  await returning.mutation(api.conventions.registrations.cancelMyBadge, {
    conventionId,
  });

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.conventions.lifecycle.updateConventionVisibility, {
      conventionId,
      visibility: "private",
    });

  await expect(
    t
      .withIdentity(playerIdentity(2))
      .mutation(api.conventions.registrations.registerSelfForConvention, {
        conventionId,
        ticketTypeId,
      }),
  ).rejects.toThrow(/not open/);
  // The cancelled row is the standing re-admission.
  await returning.mutation(
    api.conventions.registrations.registerSelfForConvention,
    { conventionId, ticketTypeId },
  );
});

test("the badge gate blocks self-registration for a gated child event and lifts with a confirmed badge", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedConvention(
    t,
    organizationId,
    { badgeRequired: true },
  );
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.conventions.events.createTournamentForConvention,
    {
      conventionId,
      name: "Gated Main Event",
      startDate: START,
      playerCapacity: 8,
      format: "modern",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await insertPlayerUser(t, 1);
  const player = t.withIdentity(playerIdentity(1));

  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).rejects.toThrow(/requires a Winter Gathering badge/);

  await player.mutation(
    api.conventions.registrations.registerSelfForConvention,
    { conventionId, ticketTypeId },
  );
  await player.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId,
  });
  const registration = await player.query(
    api.tournaments.registrations.getMyRegistration,
    { tournamentId },
  );
  expect(registration?.entryStatus).toBe("confirmed");
});

test("the badge gate is an admission gate only: cancelling the badge keeps child registrations, and ungated children never check", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedConvention(
    t,
    organizationId,
    { badgeRequired: true },
  );
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.conventions.events.createTournamentForConvention,
    {
      conventionId,
      name: "Gated Main Event",
      startDate: START,
      playerCapacity: 8,
      format: "modern",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await insertPlayerUser(t, 1);
  const player = t.withIdentity(playerIdentity(1));
  await player.mutation(
    api.conventions.registrations.registerSelfForConvention,
    { conventionId, ticketTypeId },
  );
  await player.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId,
  });

  // Non-retroactive: the child seat survives the badge's cancellation.
  await player.mutation(api.conventions.registrations.cancelMyBadge, {
    conventionId,
  });
  expect(
    (
      await player.query(api.tournaments.registrations.getMyRegistration, {
        tournamentId,
      })
    )?.entryStatus,
  ).toBe("confirmed");

  // Turning the gate off opens child events to everyone.
  await organizer.mutation(api.conventions.lifecycle.updateConventionSetup, {
    conventionId,
    badgeRequiredForChildEvents: false,
  });
  await insertPlayerUser(t, 2);
  await t
    .withIdentity(playerIdentity(2))
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
});

test("the organizer can remove a badge holder", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const { conventionId, ticketTypeId } = await seedConvention(
    t,
    organizationId,
  );
  await insertPlayerUser(t, 1);
  const player = t.withIdentity(playerIdentity(1));
  const badgeId = await player.mutation(
    api.conventions.registrations.registerSelfForConvention,
    { conventionId, ticketTypeId },
  );

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.conventions.registrations.removeBadge, {
      registrationId: badgeId,
    });
  expect(
    (
      await player.query(api.conventions.registrations.getMyBadge, {
        conventionId,
      })
    )?.entryStatus,
  ).toBe("cancelled");
  expect(
    (await t.run(async (ctx) => ctx.db.get(conventionId)))
      ?.confirmedRegistrationCount,
  ).toBe(0);

  const log = await t
    .withIdentity(organizerIdentity)
    .query(api.conventions.auditLog.listAuditEvents, {
      conventionId,
      paginationOpts: { numItems: 4, cursor: null },
    });
  expect(log.page[0]?.event.type).toBe("badge_removed");
});
