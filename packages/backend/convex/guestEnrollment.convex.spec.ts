/// <reference types="vite/client" />

// Organizer enrollment (CONTEXT.md "Enrollment", model/roster.ts
// enrollPlayer): seating a player by name or email without an account. The
// identity rules — an existing account takes the registration directly, a
// Guest already carrying the email is reused, otherwise a new Guest — the
// entry gates it keeps (lifecycle, capacity, the per-status handling of an
// existing row), the gates it bypasses by design (approval mode, the entry
// fee), and the Claim that later merges an enrolled Guest into the account
// that signs in with its email.

import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { TournamentAuditEvent } from "./model/auditLog";
import { UserError } from "./model/errors";
import schema from "./schema";
import {
  insertLinkedParticipant,
  organizerIdentity,
  playerIdentity,
  rejection,
  seedOrganizer,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

test("enrolling by name seats a new Guest: participant, confirmed row, seat, audit event", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);

  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, displayName: "  Walk-up Wanda  " },
  );

  const registration = await getRegistration(t, registrationId);
  expect(registration).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
    // A guest's stamps are the organizer-provided name, trimmed.
    playerName: "Walk-up Wanda",
    organizerLabel: "Walk-up Wanda",
  });
  expect(registration?.awaitingReview).toBeUndefined();
  const participant = await t.run(
    async (ctx) => await ctx.db.get(registration!.participantId),
  );
  expect(participant).toMatchObject({ displayName: "Walk-up Wanda" });
  expect(participant?.userId).toBeUndefined();
  expect(participant?.contactEmail).toBeUndefined();
  expect(await confirmedCount(t, tournamentId)).toBe(1);

  const enrolled = await auditEventsOfType(t, tournamentId, "player_enrolled");
  expect(enrolled).toHaveLength(1);
  expect(enrolled[0].actorRole).toBe("organizer");
  expect(enrolled[0].event).toMatchObject({
    asGuest: true,
    player: { registrationId, playerName: "Walk-up Wanda" },
  });

  // The roster shows the guest like any seated player.
  const rows = await organizerRegistrationRows(t, tournamentId);
  expect(rows.map((row) => row.playerName)).toEqual(["Walk-up Wanda"]);
});

test("enrolling by email registers an existing account's participant directly", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const userId = await insertPlayerUser(t, 1);

  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    {
      tournamentId,
      // The organizer's spelling of the name and the email both differ from
      // the account's: the email matches on its normalized form, and the
      // account's own name wins the stamp.
      displayName: "P. One",
      email: " Player1@Example.TEST ",
    },
  );

  await t.run(async (ctx) => {
    const registration = await ctx.db.get(registrationId);
    const participant = await ctx.db.get(registration!.participantId);
    expect(participant?.userId).toBe(userId);
    expect(registration).toMatchObject({
      entryStatus: "confirmed",
      playerName: "Player 1",
      organizerLabel: "Player 1",
    });
    // No Guest was minted for an email an account already holds.
    expect(await ctx.db.query("participants").collect()).toHaveLength(1);
  });
  const enrolled = await auditEventsOfType(t, tournamentId, "player_enrolled");
  expect(enrolled[0].event).toMatchObject({ asGuest: false });

  // The account holder already holds the registration as their own.
  const player = t.withIdentity(playerIdentity(1));
  expect(
    await player.query(api.tournaments.registrations.getMyRegistration, {
      tournamentId,
    }),
  ).toMatchObject({ _id: registrationId });
  const mine = await player.query(
    api.tournaments.registrations.listMyTournaments,
    {},
  );
  expect(mine.map((row) => row.registration._id)).toEqual([registrationId]);
});

test("the same email across events reuses one Guest, and signing in claims every event", async () => {
  const t = createConvexTest();
  const { tournamentId: first, organizationId } = await seedOpenTournament(t);
  const second = await createOpenTournament(t, organizationId, "Second");
  const organizer = t.withIdentity(organizerIdentity);

  const firstId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId: first, displayName: "Gary", email: "gary@example.test" },
  );
  const secondId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    {
      tournamentId: second,
      displayName: "Gary G.",
      email: "GARY@Example.test",
    },
  );

  const guestId = await t.run(async (ctx) => {
    const firstRow = await ctx.db.get(firstId);
    const secondRow = await ctx.db.get(secondId);
    expect(secondRow?.participantId).toBe(firstRow?.participantId);
    const guest = await ctx.db.get(firstRow!.participantId);
    // The latest organizer-provided name is the guest's; each row keeps
    // the stamp it was enrolled with.
    expect(guest).toMatchObject({
      displayName: "Gary G.",
      contactEmail: "gary@example.test",
    });
    expect(firstRow?.playerName).toBe("Gary");
    expect(secondRow?.playerName).toBe("Gary G.");
    return guest!._id;
  });

  // Gary signs in with the enrolled email: the Claim merges the guest.
  const gary = t.withIdentity({
    issuer: "https://convex.test",
    subject: "gary",
    tokenIdentifier: "https://convex.test|gary",
    email: "Gary@Example.TEST",
    name: "Gary Guest",
  });
  await gary.mutation(api.users.upsertMe, {});
  await t.run(async (ctx) => {
    expect(await ctx.db.get(guestId)).toBeNull();
  });
  const mine = await gary.query(
    api.tournaments.registrations.listMyTournaments,
    {},
  );
  expect(mine.map((row) => row.registration._id).sort()).toEqual(
    [firstId, secondId].sort(),
  );
});

test("enrolling without an email always creates a fresh Guest", async () => {
  const t = createConvexTest();
  const { tournamentId: first, organizationId } = await seedOpenTournament(t);
  const second = await createOpenTournament(t, organizationId, "Second");
  const organizer = t.withIdentity(organizerIdentity);

  const firstId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId: first, displayName: "Sam" },
  );
  const secondId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId: second, displayName: "Sam" },
  );

  await t.run(async (ctx) => {
    const firstRow = await ctx.db.get(firstId);
    const secondRow = await ctx.db.get(secondId);
    expect(secondRow?.participantId).not.toBe(firstRow?.participantId);
  });
});

test("an existing row for the identity is handled per entry status", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const enroll = (email: string) =>
    organizer.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId,
      displayName: "Someone",
      email,
    });

  // Confirmed: already in.
  await insertPlayerUser(t, 1);
  const seatedId = await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
  await expectRefusal(
    enroll(playerIdentity(1).email),
    "This player is already registered",
  );

  // Pending and waitlisted: the review verbs decide, not enrollment.
  const pendingId = await seedApplication(t, tournamentId, 2, "pending");
  await expectRefusal(
    enroll(playerIdentity(2).email),
    "This player already has a pending registration — approve it from their row instead",
  );
  expect(await getRegistration(t, pendingId)).toMatchObject({
    entryStatus: "pending",
  });
  await seedApplication(t, tournamentId, 3, "waitlisted");
  await expectRefusal(
    enroll(playerIdentity(3).email),
    "This player is on the waitlist — approve their registration to seat them",
  );

  // Rejected: the decision stands until an approval reverses it.
  await organizer.mutation(api.tournaments.registrations.rejectRegistration, {
    registrationId: seatedId,
  });
  await expectRefusal(
    enroll(playerIdentity(1).email),
    "This player's registration was declined — approve it from their row to re-admit them",
  );
  expect(await getRegistration(t, seatedId)).toMatchObject({
    entryStatus: "rejected",
  });

  // Cancelled: the released seat is retaken on the same row.
  await insertPlayerUser(t, 4);
  const player4 = t.withIdentity(playerIdentity(4));
  const cancelledId = await player4.mutation(
    api.tournaments.registrations.registerSelf,
    { tournamentId },
  );
  await player4.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  expect(await confirmedCount(t, tournamentId)).toBe(0);
  expect(await enroll(playerIdentity(4).email)).toBe(cancelledId);
  expect(await getRegistration(t, cancelledId)).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
  });
  expect(await confirmedCount(t, tournamentId)).toBe(1);
  expect(
    await auditEventsOfType(t, tournamentId, "player_enrolled"),
  ).toHaveLength(1);
});

test("enrollment keeps the lifecycle, capacity, and organizer gates", async () => {
  const t = createConvexTest();
  const { tournamentId, organizationId } = await seedOpenTournament(t, {
    playerCapacity: 2,
  });
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.tournaments.registrations.enrollPlayer, {
    tournamentId,
    displayName: "One",
  });
  await organizer.mutation(api.tournaments.registrations.enrollPlayer, {
    tournamentId,
    displayName: "Two",
  });
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId,
      displayName: "Three",
      email: "three@example.test",
    }),
    "Tournament is at capacity",
  );
  // The refused enrollment left no Guest behind.
  await t.run(async (ctx) => {
    expect(await ctx.db.query("participants").collect()).toHaveLength(2);
  });

  // Not yet published: no seats are taken before registration opens.
  const unpublished = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Unpublished",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId: unpublished,
      displayName: "Early",
    }),
    "Tournament is not open for registration",
  );

  // Only organizers enroll.
  await insertPlayerUser(t, 9);
  await expect(
    t
      .withIdentity(playerIdentity(9))
      .mutation(api.tournaments.registrations.enrollPlayer, {
        tournamentId,
        displayName: "Intruder",
      }),
  ).rejects.toThrow();
});

test("enrollment validates the name and the email", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);

  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId,
      displayName: "   ",
    }),
    "Enter the player's name",
  );
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId,
      displayName: "x".repeat(81),
    }),
    "Player name must be 80 characters or fewer",
  );
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId,
      displayName: "No At Sign",
      email: "not-an-email",
    }),
    "Enter a valid email address",
  );
  // A blank email is no email: a plain guest, not a refusal.
  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, displayName: "Blank Email", email: "   " },
  );
  const participant = await t.run(async (ctx) => {
    const registration = await ctx.db.get(registrationId);
    return await ctx.db.get(registration!.participantId);
  });
  expect(participant?.contactEmail).toBeUndefined();
});

test("enrollment is the admission decision: a seat even under approval mode", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t, {
    requiresApproval: true,
  });
  const organizer = t.withIdentity(organizerIdentity);

  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, displayName: "Vouched" },
  );

  const registration = await getRegistration(t, registrationId);
  expect(registration).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
  });
  expect(registration?.awaitingReview).toBeUndefined();
  expect(
    await organizer.query(api.tournaments.registrations.getPendingReviewCount, {
      tournamentId,
    }),
  ).toMatchObject({ count: 0 });
  expect(await confirmedCount(t, tournamentId)).toBe(1);
});

test("on a paid event an enrolled guest is seated, reseated, and re-admitted without an order", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t, { entryFeeCents: 2000 });
  const organizer = t.withIdentity(organizerIdentity);

  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, displayName: "Cash Carl", email: "carl@example.test" },
  );
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "confirmed",
  });
  expect(await orderCount(t)).toBe(0);
  expect(
    await auditEventsOfType(t, tournamentId, "payment_requested"),
  ).toHaveLength(0);

  // Cancel and restore: the free arm, since a guest cannot be billed.
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId,
  });
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "cancelled",
  });
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    {
      registrationId,
    },
  );
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
  });
  expect(await orderCount(t)).toBe(0);

  // Reject and approve: likewise re-admitted straight to the seat.
  await organizer.mutation(api.tournaments.registrations.rejectRegistration, {
    registrationId,
  });
  await organizer.mutation(api.tournaments.registrations.approveRegistration, {
    registrationId,
  });
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
  });
  expect(await orderCount(t)).toBe(0);
  expect(
    await auditEventsOfType(t, tournamentId, "payment_requested"),
  ).toHaveLength(0);
  expect(await confirmedCount(t, tournamentId)).toBe(1);
});

async function seedOpenTournament(
  t: TestConvex<typeof schema>,
  options: {
    playerCapacity?: number;
    requiresApproval?: boolean;
    entryFeeCents?: number;
  } = {},
) {
  const { organizationId, userId } = await seedOrganizer(t, 1000);
  const organizer = t.withIdentity(organizerIdentity);
  if (options.entryFeeCents !== undefined) {
    // An entry fee needs a payout-ready organization; the snapshot row is
    // enough — setting the fee reads it and never calls Stripe.
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("organizationStripeAccounts", {
        organizationId,
        stripeAccountId: "acct_test_ready",
        country: "us",
        transfersCapabilityStatus: "active",
        payoutsReady: true,
        lastSyncedAt: now,
        createdBy: userId,
        updatedAt: now,
      });
    });
  }
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Enrollment Event",
      startDate: Date.now(),
      playerCapacity: options.playerCapacity ?? 8,
      format: "standard",
      isTestEvent: false,
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  if (options.requiresApproval || options.entryFeeCents !== undefined) {
    await organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
      tournamentId,
      registrationRequiresApproval: options.requiresApproval ?? false,
      ...(options.entryFeeCents !== undefined
        ? { entryFeeCents: options.entryFeeCents }
        : {}),
    });
  }
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  return { tournamentId, organizationId };
}

async function createOpenTournament(
  t: TestConvex<typeof schema>,
  organizationId: Id<"organizations">,
  name: string,
) {
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name,
      startDate: Date.now() + 86_400_000,
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  return tournamentId;
}

async function insertPlayerUser(
  t: TestConvex<typeof schema>,
  playerNumber: number,
): Promise<Id<"users">> {
  const identity = playerIdentity(playerNumber);
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      publicCode: playerNumber,
      email: identity.email,
      name: identity.name,
      updatedAt: Date.now(),
    });
  });
}

// An application row in a review-flow state — the shape registerSelf files
// under approval mode — for the account of the numbered player.
async function seedApplication(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  playerNumber: number,
  entryStatus: "pending" | "waitlisted",
): Promise<Id<"tournamentRegistrations">> {
  const userId = await insertPlayerUser(t, playerNumber);
  return await t.run(async (ctx) => {
    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found in test setup");
    }
    const participantId = await insertLinkedParticipant(ctx, userId);
    const now = Date.now();
    return await ctx.db.insert("tournamentRegistrations", {
      tournamentId,
      participantId,
      tournamentStartDate: tournament.startDate,
      entryStatus,
      ...(entryStatus === "pending" ? { awaitingReview: true as const } : {}),
      playerName: playerIdentity(playerNumber).name,
      organizerLabel: playerIdentity(playerNumber).name,
      createdAt: now,
      tiebreakRandom: playerNumber,
      updatedAt: now,
    });
  });
}

// A refusal written for the organizer travels as ConvexError data (prod
// deployments redact a plain Error's message), so both the class and the
// payload are asserted.
async function expectRefusal(call: Promise<unknown>, message: string) {
  const refusal = await rejection(call);
  expect(refusal).toBeInstanceOf(UserError);
  expect(refusal).toMatchObject({ data: message });
}

async function getRegistration(
  t: TestConvex<typeof schema>,
  registrationId: Id<"tournamentRegistrations">,
): Promise<Doc<"tournamentRegistrations"> | null> {
  return await t.run(async (ctx) => await ctx.db.get(registrationId));
}

async function organizerRegistrationRows(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const page = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.registrations.listRegistrationPage, {
      tournamentId,
      paginationOpts: { numItems: 100, cursor: null },
    });
  return page.page;
}

async function confirmedCount(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
): Promise<number> {
  const tournament = await t.run(async (ctx) => await ctx.db.get(tournamentId));
  if (!tournament) {
    throw new Error("Tournament not found");
  }
  return tournament.confirmedRegistrationCount;
}

async function orderCount(t: TestConvex<typeof schema>): Promise<number> {
  return await t.run(
    async (ctx) => (await ctx.db.query("paymentOrders").collect()).length,
  );
}

async function auditEventsOfType<T extends TournamentAuditEvent["type"]>(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  type: T,
) {
  const page = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.auditLog.listAuditEvents, {
      tournamentId,
      paginationOpts: { numItems: 100, cursor: null },
    });
  return page.page.filter(
    (
      row,
    ): row is (typeof page.page)[number] & {
      event: Extract<TournamentAuditEvent, { type: T }>;
    } => row.event.type === type,
  );
}
