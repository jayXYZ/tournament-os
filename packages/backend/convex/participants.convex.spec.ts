/// <reference types="vite/client" />

// The durable participant identity (CONTEXT.md "Participant", ADR 0002):
// registrations belong to participants, exactly one participant exists per
// user account, a Guest is a participant without one, and signing in claims
// matching guests — whole-guest merges only.

import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { createGuestParticipant } from "./model/participants";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

const playerIdentity = {
  issuer: "https://convex.test",
  subject: "player-gary",
  tokenIdentifier: "https://convex.test|player-gary",
  email: "GARY@Example.TEST",
  name: "Gary",
};

async function createOpenTournament(
  t: ReturnType<typeof createConvexTest>,
  organizationId: Id<"organizations">,
  name: string,
) {
  const authed = t.withIdentity(organizerIdentity);
  const tournamentId = await authed.mutation(
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
  await authed.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  return tournamentId;
}

// Seeds a Guest with a registration in the tournament, exercising the real
// guest writer (createGuestParticipant normalizes the contact email).
async function seedGuestRegistration(
  t: ReturnType<typeof createConvexTest>,
  tournamentId: Id<"tournaments">,
  contactEmail?: string,
) {
  return await t.run(async (ctx) => {
    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found in test setup");
    }
    const participantId = await createGuestParticipant(ctx, {
      displayName: "Guest Gary",
      contactEmail,
    });
    const registrationId = await ctx.db.insert("tournamentRegistrations", {
      tournamentId,
      participantId,
      tournamentStartDate: tournament.startDate,
      entryStatus: "confirmed",
      participationStatus: "active",
      playerName: "Guest Gary",
      createdAt: Date.now(),
      tiebreakRandom: 99,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(tournamentId, {
      confirmedRegistrationCount: tournament.confirmedRegistrationCount + 1,
    });
    return { participantId, registrationId };
  });
}

test("registering for two tournaments reuses one participant per user", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const first = await createOpenTournament(t, organizationId, "First Event");
  const second = await createOpenTournament(t, organizationId, "Second Event");

  const player = t.withIdentity(playerIdentity);
  const firstRegistrationId = await player.mutation(
    api.tournaments.registrations.registerSelf,
    { tournamentId: first },
  );
  const secondRegistrationId = await player.mutation(
    api.tournaments.registrations.registerSelf,
    { tournamentId: second },
  );

  await t.run(async (ctx) => {
    const participants = await ctx.db.query("participants").collect();
    // One for the player; the organizer never registered, so none exists for
    // them (participants are created at first need, not at sign-in).
    expect(participants).toHaveLength(1);
    const [participant] = participants;
    expect(participant.userId).toBeDefined();
    expect(participant.displayName).toBeUndefined();
    const firstRegistration = await ctx.db.get(firstRegistrationId);
    const secondRegistration = await ctx.db.get(secondRegistrationId);
    expect(firstRegistration?.participantId).toBe(participant._id);
    expect(secondRegistration?.participantId).toBe(participant._id);
  });
});

test("signing in claims a guest whose contact email matches", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await createOpenTournament(
    t,
    organizationId,
    "Guest Event",
  );
  // Stored mixed-case; createGuestParticipant normalizes it, and the sign-in
  // email (also mixed-case) normalizes to the same key.
  const guest = await seedGuestRegistration(
    t,
    tournamentId,
    "Gary@Example.test",
  );

  const player = t.withIdentity(playerIdentity);
  await player.mutation(api.users.upsertMe, {});

  await t.run(async (ctx) => {
    expect(await ctx.db.get(guest.participantId)).toBeNull();
    const registration = await ctx.db.get(guest.registrationId);
    const participant = registration
      ? await ctx.db.get(registration.participantId)
      : null;
    expect(participant?.userId).toBeDefined();
  });
  // The claimed history is now the account's own: the player resolves the
  // guest-era registration as theirs.
  const myRegistration = await player.query(
    api.tournaments.registrations.getMyRegistration,
    { tournamentId },
  );
  expect(myRegistration?._id).toBe(guest.registrationId);
});

test("a claim collision leaves the guest fully unclaimed", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const collidingId = await createOpenTournament(
    t,
    organizationId,
    "Colliding Event",
  );
  const otherId = await createOpenTournament(t, organizationId, "Other Event");

  // The player self-registers in the colliding event before the guest's
  // claim is attempted, so both identities hold a seat there.
  const player = t.withIdentity(playerIdentity);
  await player.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId: collidingId,
  });
  const guest = await t.run(async (ctx) => {
    const colliding = await ctx.db.get(collidingId);
    const other = await ctx.db.get(otherId);
    if (!colliding || !other) {
      throw new Error("Tournaments not found in test setup");
    }
    const participantId = await createGuestParticipant(ctx, {
      displayName: "Guest Gary",
      contactEmail: "gary@example.test",
    });
    const registrationIds = [];
    for (const tournament of [colliding, other]) {
      registrationIds.push(
        await ctx.db.insert("tournamentRegistrations", {
          tournamentId: tournament._id,
          participantId,
          tournamentStartDate: tournament.startDate,
          entryStatus: "confirmed",
          participationStatus: "active",
          playerName: "Guest Gary",
          createdAt: Date.now(),
          tiebreakRandom: 99,
          updatedAt: Date.now(),
        }),
      );
    }
    return { participantId, registrationIds };
  });

  await player.mutation(api.users.upsertMe, {});

  // Whole-guest merges only (ADR 0002): the collision in one tournament
  // keeps every guest registration on the guest identity, which survives.
  await t.run(async (ctx) => {
    const guestRow = await ctx.db.get(guest.participantId);
    expect(guestRow).not.toBeNull();
    expect(guestRow?.userId).toBeUndefined();
    for (const registrationId of guest.registrationIds) {
      const registration = await ctx.db.get(registrationId);
      expect(registration?.participantId).toBe(guest.participantId);
    }
  });
});

test("a guest without a contact email is never claimed", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await createOpenTournament(
    t,
    organizationId,
    "Anonymous Guest Event",
  );
  const guest = await seedGuestRegistration(t, tournamentId, undefined);

  const player = t.withIdentity(playerIdentity);
  await player.mutation(api.users.upsertMe, {});

  await t.run(async (ctx) => {
    const guestRow = await ctx.db.get(guest.participantId);
    expect(guestRow).not.toBeNull();
    expect(guestRow?.userId).toBeUndefined();
  });
});
