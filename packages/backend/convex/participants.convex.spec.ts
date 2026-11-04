/// <reference types="vite/client" />

// The durable participant identity (CONTEXT.md "Participant", ADR 0002):
// registrations belong to participants, exactly one participant exists per
// user account, a Guest is a participant without one, and signing in claims
// matching guests — whole-guest merges only.

import { afterEach, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
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

// A regular enrolled week after week under one email accumulates one long
// history; past the sign-in's inline bound the Claim moves it through a
// scheduled walk instead of skipping it.
const LONG_HISTORY = 150;

afterEach(() => {
  vi.useRealTimers();
});

// A guest holding `count` registrations, one per tournament as the
// invariant requires. The tournaments are copies of a real one: the claim
// reads only registrations, never the events themselves. `placeLast` puts
// the final row in that tournament instead.
async function seedLongGuestHistory(
  t: ReturnType<typeof createConvexTest>,
  template: Id<"tournaments">,
  count: number,
  placeLast?: Id<"tournaments">,
  entryStatus: "cancelled" | "confirmed" = "cancelled",
) {
  return await t.run(async (ctx: MutationCtx) => {
    const source = await ctx.db.get(template);
    if (!source) {
      throw new Error("Tournament not found in test setup");
    }
    const { _id, _creationTime, ...fields } = source;
    const participantId = await createGuestParticipant(ctx, {
      displayName: "Regular Gary",
      contactEmail: "gary@example.test",
    });
    for (let index = 0; index < count; index += 1) {
      const tournamentId =
        placeLast !== undefined && index === count - 1
          ? placeLast
          : await ctx.db.insert("tournaments", fields);
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        participantId,
        tournamentStartDate: fields.startDate,
        entryStatus,
        playerName: "Regular Gary",
        createdAt: Date.now(),
        tiebreakRandom: index,
        updatedAt: Date.now(),
      });
    }
    return participantId;
  });
}

async function registrationsOf(
  t: ReturnType<typeof createConvexTest>,
  participantId: Id<"participants">,
) {
  return await t.run(async (ctx) =>
    (await ctx.db.query("tournamentRegistrations").collect()).filter(
      (row) => row.participantId === participantId,
    ),
  );
}

test("signing in claims a guest whose history outgrew the inline claim", async () => {
  vi.useFakeTimers();
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await createOpenTournament(t, organizationId, "Weekly");
  const guestId = await seedLongGuestHistory(t, tournamentId, LONG_HISTORY);

  const player = t.withIdentity(playerIdentity);
  await player.mutation(api.users.upsertMe, {});
  // A second sign-in while the walk is under way schedules no second walk.
  await player.mutation(api.users.upsertMe, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const claimer = await t.run(async (ctx) =>
    (await ctx.db.query("participants").collect()).find(
      (row) => row.userId !== undefined,
    ),
  );
  expect(await registrationsOf(t, claimer!._id)).toHaveLength(LONG_HISTORY);
  await t.run(async (ctx) => {
    expect(await ctx.db.get(guestId)).toBeNull();
  });
});

test("a collision anywhere in a long history leaves the guest fully unclaimed", async () => {
  vi.useFakeTimers();
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const weekly = await createOpenTournament(t, organizationId, "Weekly");
  const shared = await createOpenTournament(t, organizationId, "Shared");
  const player = t.withIdentity(playerIdentity);
  // The account holder entered the shared event themself; the guest's
  // entry there is the last row of its history, past the first page.
  await player.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId: shared,
  });
  const guestId = await seedLongGuestHistory(t, weekly, LONG_HISTORY, shared);

  await player.mutation(api.users.upsertMe, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await registrationsOf(t, guestId)).toHaveLength(LONG_HISTORY);
  await t.run(async (ctx) => {
    expect(await ctx.db.get(guestId)).not.toBeNull();
  });
});

test("registering into an event while the walk is still to run takes the guest's entry there, never a second seat", async () => {
  vi.useFakeTimers();
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const weekly = await createOpenTournament(t, organizationId, "Weekly");
  const current = await createOpenTournament(t, organizationId, "Current");
  // The guest's newest row is the seat the organizer enrolled in the
  // current event.
  const guestId = await seedLongGuestHistory(t, weekly, LONG_HISTORY, current);
  const enrolledSeat = await t.run(async (ctx) => {
    const row = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId_and_participantId", (q) =>
        q.eq("tournamentId", current).eq("participantId", guestId),
      )
      .unique();
    await ctx.db.patch(row!._id, {
      entryStatus: "confirmed",
      participationStatus: "active",
      entryFeeExempt: true,
    });
    await ctx.db.patch(current, { confirmedRegistrationCount: 1 });
    return row!._id;
  });

  // Registering is the player's first signed-in action: the sign-in hands
  // the guest to the walk and moves nothing itself, so the registration
  // claims the one entry the guest holds in this event rather than filing a
  // second one — which the walk would then have refused as a collision.
  const player = t.withIdentity(playerIdentity);
  expect(
    await player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId: current,
    }),
  ).toBe(enrolledSeat);
  const claimer = await t.run(async (ctx) =>
    (await ctx.db.query("participants").collect()).find(
      (row) => row.userId !== undefined,
    ),
  );
  const inCurrent = await t.run(
    async (ctx) =>
      await ctx.db
        .query("tournamentRegistrations")
        .withIndex("by_tournamentId_and_participantId", (q) =>
          q.eq("tournamentId", current),
        )
        .collect(),
  );
  expect(inCurrent).toHaveLength(1);
  expect(inCurrent[0]).toMatchObject({
    _id: enrolledSeat,
    participantId: claimer!._id,
    entryStatus: "confirmed",
    playerName: "Gary",
  });
  await t.run(async (ctx) => {
    expect((await ctx.db.get(current))?.confirmedRegistrationCount).toBe(1);
  });

  // The walk then merges the rest of the history.
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await registrationsOf(t, claimer!._id)).toHaveLength(LONG_HISTORY);
  await t.run(async (ctx) => {
    expect(await ctx.db.get(guestId)).toBeNull();
  });
});

// Participant of the account that signed in with this identity.
async function participantOfIdentity(
  t: ReturnType<typeof createConvexTest>,
  tokenIdentifier: string,
) {
  return await t.run(async (ctx) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", tokenIdentifier),
      )
      .unique();
    if (!user) {
      throw new Error("User not found in test");
    }
    return await ctx.db
      .query("participants")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
  });
}

// The walk pages across transactions, so the guest's history can change
// under it. The check phase must still see every row that could collide:
// here the colliding row is the last of the history and an organizer
// cancels it after the first check page has run. A cursor keyed on entry
// status would then find it moved behind the cursor, miss the collision,
// and merge all but that row — a partial merge the whole-guest rule forbids.
test("an entry changing status between check pages cannot hide a collision from the walk", async () => {
  vi.useFakeTimers();
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const weekly = await createOpenTournament(t, organizationId, "Weekly");
  const shared = await createOpenTournament(t, organizationId, "Shared");
  const player = t.withIdentity(playerIdentity);
  await player.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId: shared,
  });
  const history = 65;
  const guestId = await seedLongGuestHistory(
    t,
    weekly,
    history,
    shared,
    "confirmed",
  );

  await player.mutation(api.users.upsertMe, {});
  // One check page runs — the first 64 rows, none colliding — and queues
  // the next.
  vi.runAllTimers();
  await t.finishInProgressScheduledFunctions();
  const lastRow = (await registrationsOf(t, guestId)).find(
    (row) => row.tournamentId === shared,
  );
  expect(lastRow).toBeDefined();
  await t.run(async (ctx) => {
    await ctx.db.patch(lastRow!._id, {
      entryStatus: "cancelled",
      updatedAt: Date.now(),
    });
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect(await registrationsOf(t, guestId)).toHaveLength(history);
  const claimer = await participantOfIdentity(
    t,
    playerIdentity.tokenIdentifier,
  );
  expect(await registrationsOf(t, claimer!._id)).toHaveLength(1);
  await t.run(async (ctx) => {
    expect(await ctx.db.get(guestId)).not.toBeNull();
  });
});

// A walk is queued by the account that held the email at sign-in. Should
// the address be verified on another account before the queue drains — an
// operator reassignment at the provider — that account's sign-in releases
// the address from the first and finds the walk under way, so it must not
// be the first account that ends up with the history: the queued step
// hands the walk to the holder the address now belongs to.
test("a walk whose claimer lost the email hands the guest to the account that holds it now", async () => {
  vi.useFakeTimers();
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const tournamentId = await createOpenTournament(t, organizationId, "Weekly");
  const guestId = await seedLongGuestHistory(t, tournamentId, LONG_HISTORY);
  const formerIdentity = playerIdentity;
  const currentIdentity = {
    ...playerIdentity,
    subject: "player-gary-again",
    tokenIdentifier: "https://convex.test|player-gary-again",
    name: "Gary Again",
  };

  await t.withIdentity(formerIdentity).mutation(api.users.upsertMe, {});
  await t.withIdentity(currentIdentity).mutation(api.users.upsertMe, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const former = await participantOfIdentity(t, formerIdentity.tokenIdentifier);
  const current = await participantOfIdentity(
    t,
    currentIdentity.tokenIdentifier,
  );
  expect(await registrationsOf(t, former!._id)).toHaveLength(0);
  expect(await registrationsOf(t, current!._id)).toHaveLength(LONG_HISTORY);
  await t.run(async (ctx) => {
    expect(await ctx.db.get(guestId)).toBeNull();
  });
});
