/// <reference types="vite/client" />

// Write-side transitions for the entry-status state machine (see CONTEXT.md
// "Entry Status" and model/roster.ts): the organizer review verbs — approve,
// reject, waitlist — and the player's own withdrawal through cancelEntry,
// alongside the register/cancel/restore paths that already exist. Nothing
// creates pending or waitlisted rows yet (registerSelf admits directly until
// the admission-mode work lands), so applications are seeded directly via
// ctx.db the way that future flow will write them: an entry status and no
// participation status.
import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  insertLinkedParticipant,
  organizerIdentity,
  seedOrganizer,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

test("an organizer approves a pending application into a confirmed seat", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const registrationId = await seedApplication(t, tournamentId, 1, "pending");

  await organizer.mutation(api.tournaments.registrations.approveRegistration, {
    registrationId,
  });

  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
  });
  expect(await confirmedCount(t, tournamentId)).toBe(1);
  const approved = await auditEventsOfType(
    t,
    tournamentId,
    "registration_approved",
  );
  expect(approved).toHaveLength(1);
  if (approved[0].event.type !== "registration_approved") {
    throw new Error("Expected a registration_approved event");
  }
  expect(approved[0].actorRole).toBe("organizer");
  expect(approved[0].event.previousEntryStatus).toBe("pending");

  // A confirmed seat has nothing left to approve or waitlist.
  await expect(
    organizer.mutation(api.tournaments.registrations.approveRegistration, {
      registrationId,
    }),
  ).rejects.toThrow("Registration cannot be approved in its current state");
  await expect(
    organizer.mutation(api.tournaments.registrations.waitlistRegistration, {
      registrationId,
    }),
  ).rejects.toThrow("Registration cannot be waitlisted in its current state");
});

test("approving an application takes a seat, so capacity applies", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t, { playerCapacity: 2 });
  const organizer = t.withIdentity(organizerIdentity);
  await registerPlayer(t, tournamentId, 1);
  await registerPlayer(t, tournamentId, 2);
  const applicationId = await seedApplication(t, tournamentId, 3, "pending");

  await expect(
    organizer.mutation(api.tournaments.registrations.approveRegistration, {
      registrationId: applicationId,
    }),
  ).rejects.toThrow("Tournament is at capacity");
  // The refused approval left the application untouched.
  expect(await getRegistration(t, applicationId)).toMatchObject({
    entryStatus: "pending",
  });
  expect(await confirmedCount(t, tournamentId)).toBe(2);
});

test("an organizer parks a pending application on the waitlist and later promotes it", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const registrationId = await seedApplication(t, tournamentId, 1, "pending");

  await organizer.mutation(api.tournaments.registrations.waitlistRegistration, {
    registrationId,
  });
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "waitlisted",
  });
  // The waitlist holds no seat.
  expect(await confirmedCount(t, tournamentId)).toBe(0);
  expect(
    await auditEventsOfType(t, tournamentId, "registration_waitlisted"),
  ).toHaveLength(1);

  // Waitlisting is pending-only — an already-waitlisted row has nowhere to go.
  await expect(
    organizer.mutation(api.tournaments.registrations.waitlistRegistration, {
      registrationId,
    }),
  ).rejects.toThrow("Registration cannot be waitlisted in its current state");

  // Approval doubles as manual waitlist promotion.
  await organizer.mutation(api.tournaments.registrations.approveRegistration, {
    registrationId,
  });
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
  });
  expect(await confirmedCount(t, tournamentId)).toBe(1);
  const approved = await auditEventsOfType(
    t,
    tournamentId,
    "registration_approved",
  );
  expect(approved).toHaveLength(1);
  if (approved[0].event.type !== "registration_approved") {
    throw new Error("Expected a registration_approved event");
  }
  expect(approved[0].event.previousEntryStatus).toBe("waitlisted");
});

test("a declined application blocks re-registration until an organizer approves it again", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const registrationId = await seedApplication(t, tournamentId, 1, "pending");

  await organizer.mutation(api.tournaments.registrations.rejectRegistration, {
    registrationId,
  });
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "rejected",
  });
  expect(await confirmedCount(t, tournamentId)).toBe(0);
  const rejected = await auditEventsOfType(
    t,
    tournamentId,
    "registration_rejected",
  );
  expect(rejected).toHaveLength(1);
  if (rejected[0].event.type !== "registration_rejected") {
    throw new Error("Expected a registration_rejected event");
  }
  expect(rejected[0].event.previousEntryStatus).toBe("pending");

  // The rejection stands against the player's own re-registration...
  await expect(
    t
      .withIdentity(playerIdentity(1))
      .mutation(api.tournaments.registrations.registerSelf, { tournamentId }),
  ).rejects.toThrow("Your registration was declined");
  // ...and rejecting again is a no-op state, not a second decision.
  await expect(
    organizer.mutation(api.tournaments.registrations.rejectRegistration, {
      registrationId,
    }),
  ).rejects.toThrow("Registration cannot be rejected in its current state");

  // approveEntry is the sanctioned reversal.
  await organizer.mutation(api.tournaments.registrations.approveRegistration, {
    registrationId,
  });
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
  });
  expect(await confirmedCount(t, tournamentId)).toBe(1);
});

test("rejecting a confirmed player releases the seat and bars re-entry", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const registrationId = await registerPlayer(t, tournamentId, 1);
  expect(await confirmedCount(t, tournamentId)).toBe(1);

  await organizer.mutation(api.tournaments.registrations.rejectRegistration, {
    registrationId,
  });

  const row = await getRegistration(t, registrationId);
  expect(row).toMatchObject({ entryStatus: "rejected" });
  // A rejected entry carries no competitive state.
  expect(row?.participationStatus).toBeUndefined();
  expect(await confirmedCount(t, tournamentId)).toBe(0);
  const rejected = await auditEventsOfType(
    t,
    tournamentId,
    "registration_rejected",
  );
  expect(rejected).toHaveLength(1);
  if (rejected[0].event.type !== "registration_rejected") {
    throw new Error("Expected a registration_rejected event");
  }
  expect(rejected[0].event.previousEntryStatus).toBe("confirmed");

  await expect(
    t
      .withIdentity(playerIdentity(1))
      .mutation(api.tournaments.registrations.registerSelf, { tournamentId }),
  ).rejects.toThrow("Your registration was declined");
});

test("rejecting a cancelled row closes the standing invitation into a private event", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const player = t.withIdentity(playerIdentity(1));
  const registrationId = await registerPlayer(t, tournamentId, 1);
  await player.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  await organizer.mutation(
    api.tournaments.lifecycle.updateTournamentVisibility,
    {
      tournamentId,
      visibility: "private",
    },
  );

  // The cancelled row is the standing invitation back in (see registerSelf) —
  // exactly what rejecting it must revoke.
  await organizer.mutation(api.tournaments.registrations.rejectRegistration, {
    registrationId,
  });

  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "rejected",
  });
  // The cancellation already released the seat; the bar releases nothing.
  expect(await confirmedCount(t, tournamentId)).toBe(0);
  const rejected = await auditEventsOfType(
    t,
    tournamentId,
    "registration_rejected",
  );
  expect(rejected).toHaveLength(1);
  if (rejected[0].event.type !== "registration_rejected") {
    throw new Error("Expected a registration_rejected event");
  }
  expect(rejected[0].event.previousEntryStatus).toBe("cancelled");
  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).rejects.toThrow("Your registration was declined");
});

test("a player withdraws their own application without touching the seat count", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  await registerPlayer(t, tournamentId, 1);
  const pendingId = await seedApplication(t, tournamentId, 2, "pending");
  const waitlistedId = await seedApplication(t, tournamentId, 3, "waitlisted");

  for (const [playerNumber, registrationId] of [
    [2, pendingId],
    [3, waitlistedId],
  ] as const) {
    await t
      .withIdentity(playerIdentity(playerNumber))
      .mutation(api.tournaments.registrations.cancelMyRegistration, {
        tournamentId,
      });
    expect(await getRegistration(t, registrationId)).toMatchObject({
      entryStatus: "cancelled",
    });
  }
  // Neither application held a seat, so only player 1's remains counted.
  expect(await confirmedCount(t, tournamentId)).toBe(1);
  const cancelled = await auditEventsOfType(
    t,
    tournamentId,
    "registration_cancelled",
  );
  expect(cancelled).toHaveLength(2);
  expect(cancelled.every((row) => row.actorRole === "player")).toBe(true);
});

test("entry review is organizer-only and closed outside the registration lifecycle", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const registrationId = await seedApplication(t, tournamentId, 1, "pending");

  // The applicant's own identity holds no organization membership, so every
  // review mutation refuses before reaching the verb — a player can never
  // decide their own (or anyone's) application.
  const outsider = t.withIdentity(playerIdentity(1));
  for (const mutationRef of [
    api.tournaments.registrations.approveRegistration,
    api.tournaments.registrations.rejectRegistration,
    api.tournaments.registrations.waitlistRegistration,
  ]) {
    await expect(
      outsider.mutation(mutationRef, { registrationId }),
    ).rejects.toThrow("Unauthorized");
  }

  // Admission decisions exist only while registration is open. The lifecycle
  // is stamped directly: the verbs read nothing else, and starting a real
  // event here would drag in pairing setup this test doesn't exercise.
  await t.run(async (ctx) => {
    await ctx.db.patch(tournamentId, { lifecycle: "in_progress" });
  });
  const organizer = t.withIdentity(organizerIdentity);
  await expect(
    organizer.mutation(api.tournaments.registrations.approveRegistration, {
      registrationId,
    }),
  ).rejects.toThrow("Registration cannot be approved in its current state");
  await expect(
    organizer.mutation(api.tournaments.registrations.rejectRegistration, {
      registrationId,
    }),
  ).rejects.toThrow("Registration cannot be rejected in its current state");
  await expect(
    organizer.mutation(api.tournaments.registrations.waitlistRegistration, {
      registrationId,
    }),
  ).rejects.toThrow("Registration cannot be waitlisted in its current state");
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "pending",
  });
});

function playerIdentity(playerNumber: number) {
  return {
    issuer: "https://convex.test",
    subject: `player-${playerNumber}`,
    tokenIdentifier: `https://convex.test|player-${playerNumber}`,
    email: `player${playerNumber}@example.test`,
    name: `Player ${playerNumber}`,
  };
}

// A published tournament sitting in the "registration" lifecycle — the only
// lifecycle in which entry decisions exist.
async function seedOpenTournament(
  t: TestConvex<typeof schema>,
  options: { playerCapacity?: number } = {},
) {
  const { organizationId } = await seedOrganizer(t, 1000);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Entry Review Event",
      startDate: Date.now(),
      playerCapacity: options.playerCapacity ?? 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  return { tournamentId, organizationId };
}

// Seeds the player's user and registers them through the real self-serve
// path, so the row and the seat counter are exactly what production writes.
async function registerPlayer(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  playerNumber: number,
): Promise<Id<"tournamentRegistrations">> {
  await insertPlayerUser(t, playerNumber);
  return await t
    .withIdentity(playerIdentity(playerNumber))
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
}

// Seeds an application row — a registration in a review-flow entry state,
// carrying no participation status and holding no seat — the shape the
// future admission-mode flow will create.
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
      playerName: playerIdentity(playerNumber).name,
      createdAt: now,
      tiebreakRandom: playerNumber,
      updatedAt: now,
    });
  });
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

async function getRegistration(
  t: TestConvex<typeof schema>,
  registrationId: Id<"tournamentRegistrations">,
): Promise<Doc<"tournamentRegistrations"> | null> {
  return await t.run(async (ctx) => await ctx.db.get(registrationId));
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

async function auditEventsOfType(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  type: string,
) {
  const page = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.auditLog.listAuditEvents, {
      tournamentId,
      paginationOpts: { numItems: 100, cursor: null },
    });
  return page.page.filter((row) => row.event.type === type);
}
