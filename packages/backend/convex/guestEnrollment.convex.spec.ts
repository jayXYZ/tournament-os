/// <reference types="vite/client" />

// Organizer enrollment (CONTEXT.md "Enrollment", model/roster.ts): the two
// direct admissions — "Enroll player" by email alone and "Add guest" by name
// alone — the entry gates they keep (lifecycle, capacity, the per-status
// handling of an existing row), the gates they bypass by design (approval
// mode, the entry fee), and what follows an email enrollment: the entry
// awaits player details (CONTEXT.md "Awaiting Player Details") in one state
// whether or not the address has an account, the Claim names it when its
// holder next uses the app, "Continue as guest" names it for one event, and
// play cannot start while any entrant has no name.

import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { TournamentAuditEvent } from "./model/auditLog";
import { UserError } from "./model/errors";
import { publicIdentityForRegistration } from "./model/participants";
import { ACCOUNT_NAME_REQUIRED } from "./model/users";
import schema from "./schema";
import {
  insertLinkedParticipant,
  organizerIdentity,
  playerIdentity,
  rawSeed,
  rejection,
  seedOrganizer,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

// A sign-in whose provider supplied no display name — refused at first
// sign-in, since an account always has a name.
const namelessIdentity = {
  issuer: "https://convex.test",
  subject: "nameless",
  tokenIdentifier: "https://convex.test|nameless",
  email: "nameless@example.test",
};

function guestIdentity(email: string, name?: string) {
  const subject = email.split("@")[0];
  return {
    issuer: "https://convex.test",
    subject,
    tokenIdentifier: `https://convex.test|${subject}`,
    email,
    ...(name === undefined ? {} : { name }),
  };
}

test("adding a guest by name seats a ready Guest: participant, confirmed row, seat, audit event", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);

  const registrationId = await organizer.mutation(
    api.tournaments.registrations.addGuest,
    { tournamentId, displayName: "  Walk-up Wanda  " },
  );

  const registration = await getRegistration(t, registrationId);
  expect(registration).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
    entryFeeExempt: true,
    // The typed name, trimmed, is this event's name for the entry.
    playerName: "Walk-up Wanda",
    organizerLabel: "Walk-up Wanda",
    organizerNamed: true,
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
    by: "name",
    player: { registrationId, playerName: "Walk-up Wanda" },
  });

  // Ready to play: the roster shows the guest like any seated player, with
  // nothing left to resolve.
  const [row] = await organizerRegistrationRows(t, tournamentId);
  expect(row).toMatchObject({
    playerName: "Walk-up Wanda",
    awaitingPlayerDetails: false,
    nameEffect: null,
  });
  expect(
    await t.run(
      async (ctx) => await publicIdentityForRegistration(ctx, registrationId),
    ),
  ).toEqual({ name: "Walk-up Wanda", avatarUrl: null });
});

test("enrolling by email seats one and the same awaiting state whether or not the address has an account", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const accountUserId = await insertPlayerUser(t, 1);

  const withAccount = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    // Matched on the normalized form; the organizer never learns it matched.
    { tournamentId, email: " Player1@Example.TEST " },
  );
  const withoutAccount = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: "gary@example.test" },
  );

  const rows = await Promise.all(
    [withAccount, withoutAccount].map(async (registrationId) => {
      const registration = await getRegistration(t, registrationId);
      const participant = await t.run(
        async (ctx) => await ctx.db.get(registration!.participantId),
      );
      return { registration: registration!, participant: participant! };
    }),
  );
  for (const [index, { registration, participant }] of rows.entries()) {
    const email = index === 0 ? "player1@example.test" : "gary@example.test";
    expect(registration).toMatchObject({
      entryStatus: "confirmed",
      participationStatus: "active",
      entryFeeExempt: true,
      organizerLabel: email,
    });
    // No name yet, and no account linked — not even the one that exists:
    // linking it would show the organizer the account's name.
    expect(registration.playerName).toBeUndefined();
    expect(registration.organizerNamed).toBeUndefined();
    expect(participant.userId).toBeUndefined();
    expect(participant.displayName).toBeUndefined();
    expect(participant.contactEmail).toBe(email);
  }
  expect(await confirmedCount(t, tournamentId)).toBe(2);

  // Both audit lines read the same way, labelled by the email the organizer
  // typed, and neither says anything about an account.
  const enrolled = await auditEventsOfType(t, tournamentId, "player_enrolled");
  expect(
    enrolled.map(({ event }) => [event.by, event.player.playerName]).sort(),
  ).toEqual([
    ["email", "gary@example.test"],
    ["email", "player1@example.test"],
  ]);
  expect(JSON.stringify(enrolled)).not.toContain("Player 1");

  // The roster identifies each entry by its email and marks it unresolved;
  // the account's profile name appears nowhere.
  const roster = await organizerRegistrationRows(t, tournamentId);
  expect(
    roster
      .map((row) => [row.playerName, row.awaitingPlayerDetails, row.nameEffect])
      .sort(),
  ).toEqual([
    ["gary@example.test", true, "name"],
    ["player1@example.test", true, "name"],
  ]);
  expect(JSON.stringify(roster)).not.toContain("Player 1");

  // Nothing resolved just because an account is cached: the account holder
  // does not hold the entry until they next use the app.
  const player = t.withIdentity(playerIdentity(1));
  expect(
    await player.query(api.tournaments.registrations.getMyRegistration, {
      tournamentId,
    }),
  ).toBeNull();
  await t.run(async (ctx) => {
    const user = await ctx.db.get(accountUserId);
    expect(user?.name).toBe("Player 1");
  });
});

test("the account holder's next authenticated action claims the entry and gives it the account's name", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const userId = await insertPlayerUser(t, 1);
  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: playerIdentity(1).email },
  );

  // Opening the app runs upsertMe (useEnsureUserRow); no sign-out needed.
  const player = t.withIdentity(playerIdentity(1));
  await player.mutation(api.users.upsertMe, {});

  await t.run(async (ctx) => {
    const registration = await ctx.db.get(registrationId);
    const participant = await ctx.db.get(registration!.participantId);
    expect(participant?.userId).toBe(userId);
    expect(registration).toMatchObject({
      entryStatus: "confirmed",
      participationStatus: "active",
      entryFeeExempt: true,
      playerName: "Player 1",
      organizerLabel: "Player 1",
    });
    expect(registration?.organizerNamed).toBeUndefined();
    // The guest that carried the email is gone: one participant, the account's.
    expect(await ctx.db.query("participants").collect()).toHaveLength(1);
  });
  const [row] = await organizerRegistrationRows(t, tournamentId);
  expect(row).toMatchObject({
    playerName: "Player 1",
    awaitingPlayerDetails: false,
    nameEffect: null,
  });
  expect(
    await player.query(api.tournaments.registrations.getMyRegistration, {
      tournamentId,
    }),
  ).toMatchObject({ _id: registrationId });
  const mine = await player.query(
    api.tournaments.registrations.listMyTournaments,
    {},
  );
  expect(mine.map((entry) => entry.registration._id)).toEqual([registrationId]);
});

test("an email enrollment is claimed only by a sign-in that carries a name", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.registrations.addGuest, {
    tournamentId,
    displayName: "Opponent",
  });
  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: namelessIdentity.email },
  );

  // An account always has a name: a first sign-in without one is refused
  // before any account is filed, so nothing claims the entry and it keeps
  // awaiting player details.
  await expectRefusal(
    t.withIdentity(namelessIdentity).mutation(api.users.upsertMe, {}),
    ACCOUNT_NAME_REQUIRED,
  );
  const unclaimed = await getRegistration(t, registrationId);
  expect(unclaimed?.playerName).toBeUndefined();
  expect(unclaimed?.organizerLabel).toBe(namelessIdentity.email);
  expect(
    await t.run(async (ctx) => {
      const participant = await ctx.db.get(unclaimed!.participantId);
      return participant?.userId ?? null;
    }),
  ).toBeNull();
  const [, row] = await organizerRegistrationRows(t, tournamentId);
  expect(row).toMatchObject({
    playerName: namelessIdentity.email,
    awaitingPlayerDetails: true,
    nameEffect: "name",
  });
  await expectRefusal(
    organizer.mutation(api.tournaments.rounds.startTournament, {
      tournamentId,
    }),
    "1 player needs a name before play can start",
  );

  // The sign-in that carries a name files the account, and the Claim
  // stamps the entry with it.
  await t
    .withIdentity({ ...namelessIdentity, name: "Newly Named" })
    .mutation(api.users.upsertMe, {});
  expect(await getRegistration(t, registrationId)).toMatchObject({
    playerName: "Newly Named",
    organizerLabel: "Newly Named",
  });
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
});

test("Continue as guest names the entry for this event only, keeping its row, email, and fee treatment", async () => {
  const t = createConvexTest();
  const { tournamentId: first, organizationId } = await seedOpenTournament(t, {
    entryFeeCents: 2000,
  });
  const second = await createOpenTournament(t, organizationId, "Second");
  const organizer = t.withIdentity(organizerIdentity);
  const firstId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId: first, email: "gary@example.test" },
  );
  const secondId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId: second, email: "GARY@Example.test" },
  );
  const guestId = (await getRegistration(t, firstId))!.participantId;
  expect((await getRegistration(t, secondId))?.participantId).toBe(guestId);

  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId: firstId,
    displayName: "  Gary G.  ",
  });

  // The same row: seat, status, and exemption intact, now named for this
  // event; the shared guest and the other event's entry are untouched.
  expect(await getRegistration(t, firstId)).toMatchObject({
    participantId: guestId,
    entryStatus: "confirmed",
    participationStatus: "active",
    entryFeeExempt: true,
    playerName: "Gary G.",
    organizerLabel: "Gary G.",
    organizerNamed: true,
  });
  await t.run(async (ctx) => {
    const guest = await ctx.db.get(guestId);
    expect(guest?.displayName).toBeUndefined();
    expect(guest?.contactEmail).toBe("gary@example.test");
    expect(await publicIdentityForRegistration(ctx, firstId)).toEqual({
      name: "Gary G.",
      avatarUrl: null,
    });
    expect(await publicIdentityForRegistration(ctx, secondId)).toEqual({
      name: null,
      avatarUrl: null,
    });
  });
  expect(await getRegistration(t, secondId)).toMatchObject({
    organizerLabel: "gary@example.test",
  });
  expect((await getRegistration(t, secondId))?.playerName).toBeUndefined();
  const named = await auditEventsOfType(t, first, "player_named");
  expect(named).toHaveLength(1);
  expect(named[0].event).toMatchObject({
    player: { registrationId: firstId, playerName: "Gary G." },
    previousLabel: "gary@example.test",
  });
  expect(await confirmedCount(t, first)).toBe(1);
  expect(await orderCount(t)).toBe(0);

  // Not a rename: a named entry is refused.
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.continueAsGuest, {
      registrationId: firstId,
      displayName: "Gary Again",
    }),
    "This player already has a name",
  );

  // Gary signs in: the Claim takes both entries. The organizer's name stays
  // on the event it was given for; the unnamed entry takes the account's.
  const gary = t.withIdentity(guestIdentity("gary@example.test", "Gary Guest"));
  await gary.mutation(api.users.upsertMe, {});
  await t.run(async (ctx) => {
    expect(await ctx.db.get(guestId)).toBeNull();
    const firstRow = await ctx.db.get(firstId);
    const secondRow = await ctx.db.get(secondId);
    expect(firstRow?.participantId).toBe(secondRow?.participantId);
    expect(firstRow).toMatchObject({
      playerName: "Gary G.",
      organizerLabel: "Gary G.",
      organizerNamed: true,
      entryFeeExempt: true,
    });
    expect(secondRow).toMatchObject({
      playerName: "Gary Guest",
      organizerLabel: "Gary Guest",
    });
    expect(secondRow?.organizerNamed).toBeUndefined();
    // Other players still see the event's name, not the account profile.
    expect(await publicIdentityForRegistration(ctx, firstId)).toEqual({
      name: "Gary G.",
      avatarUrl: null,
    });
  });
  // A later profile change leaves the event's name alone too.
  await t
    .withIdentity(guestIdentity("gary@example.test", "Garrett"))
    .mutation(api.users.upsertMe, {});
  expect((await getRegistration(t, firstId))?.playerName).toBe("Gary G.");
  expect((await getRegistration(t, secondId))?.playerName).toBe("Garrett");

  // The claimed entry still reseats free on the paid event. The event's
  // name ended with the entry, though: cancelling an account holder's entry
  // drops the organizer's label for the account's own name (organizers
  // name guests, not account holders), so it comes back as Garrett.
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: firstId,
  });
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    {
      registrationId: firstId,
    },
  );
  const reseated = await getRegistration(t, firstId);
  expect(reseated).toMatchObject({
    entryStatus: "confirmed",
    entryFeeExempt: true,
    playerName: "Garrett",
  });
  expect(reseated?.organizerNamed).toBeUndefined();
  expect(await orderCount(t)).toBe(0);
});

test("play waits for every entrant's name: the board lists who, and naming or removing them clears the gate", async () => {
  const t = createConvexTest();
  const { tournamentId, organizationId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.registrations.addGuest, {
    tournamentId,
    displayName: "Alice",
  });
  await organizer.mutation(api.tournaments.registrations.addGuest, {
    tournamentId,
    displayName: "Bob",
  });
  const xId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: "x@example.test" },
  );
  const yId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: "y@example.test" },
  );

  const blocked = await organizer.query(
    api.tournaments.rounds.getPairingsBoard,
    {
      tournamentId,
    },
  );
  expect(blocked.nextStep).toMatchObject({
    kind: "startTournament",
    ready: false,
    reason: "2 players need a name before play can start",
  });
  expect(
    blocked.playersAwaitingDetails
      .map((entry) => [entry.registrationId, entry.label])
      .sort(),
  ).toEqual(
    [
      [xId, "x@example.test"],
      [yId, "y@example.test"],
    ].sort(),
  );
  await expectRefusal(
    organizer.mutation(api.tournaments.rounds.startTournament, {
      tournamentId,
    }),
    "2 players need a name before play can start",
  );

  // Name one, remove the other (the ordinary pre-start drop, which cancels
  // the entry): a cancelled entry is not in play and holds nothing.
  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId: xId,
    displayName: "Xavier",
  });
  expect(
    (
      await organizer.query(api.tournaments.rounds.getPairingsBoard, {
        tournamentId,
      })
    ).nextStep,
  ).toMatchObject({
    ready: false,
    reason: "1 player needs a name before play can start",
  });
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: yId,
  });
  const ready = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(ready.nextStep).toMatchObject({
    kind: "startTournament",
    ready: true,
  });
  expect(ready.playersAwaitingDetails).toEqual([]);

  const roundId = await organizer.mutation(
    api.tournaments.rounds.startTournament,
    { tournamentId },
  );
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId },
  );
  expect(
    pairings
      .flatMap(({ players }) => players.map((player) => player.playerName))
      .sort(),
  ).toEqual(["Alice", "Bob", "Xavier"]);
  expect(JSON.stringify(pairings)).not.toContain("@example.test");

  // The meeting keeps the same gate.
  const meetingEvent = await createOpenTournament(
    t,
    organizationId,
    "Meeting",
    {
      playerMeeting: true,
    },
  );
  await organizer.mutation(api.tournaments.registrations.addGuest, {
    tournamentId: meetingEvent,
    displayName: "Alice",
  });
  await organizer.mutation(api.tournaments.registrations.enrollPlayer, {
    tournamentId: meetingEvent,
    email: "z@example.test",
  });
  const meetingBoard = await organizer.query(
    api.tournaments.rounds.getPairingsBoard,
    { tournamentId: meetingEvent },
  );
  expect(meetingBoard.nextStep).toMatchObject({
    kind: "startPlayerMeeting",
    ready: false,
    reason: "1 player needs a name before play can start",
  });
  const phaseId = await firstPhaseId(t, meetingEvent);
  await expectRefusal(
    organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
      phaseId,
    }),
    "1 player needs a name before play can start",
  );
});

test("an entry awaiting player details shows no name to other players, and its email reaches no player-facing read", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: "quiet@example.test" },
  );
  await t.run(async (ctx) => {
    expect(await publicIdentityForRegistration(ctx, registrationId)).toEqual({
      name: null,
      avatarUrl: null,
    });
  });
  // The organizer's roster is the one place the email identifies the entry.
  const [row] = await organizerRegistrationRows(t, tournamentId);
  expect(row.playerName).toBe("quiet@example.test");
  expect(row.awaitingPlayerDetails).toBe(true);
});

test("an existing row for the identity is handled per entry status, for the account's row and the guest's", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const enroll = (email: string) =>
    organizer.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId,
      email,
    });

  // Confirmed: already in — the refusal names no one.
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

  // Cancelled: the account's released seat is retaken on its own row, which
  // keeps the stamps it already carries, now fee-exempt.
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
    entryFeeExempt: true,
    playerName: "Player 4",
  });
  expect(await confirmedCount(t, tournamentId)).toBe(1);
  // No Guest was minted for an address whose account already had a row.
  await t.run(async (ctx) => {
    for (const participant of await ctx.db.query("participants").collect()) {
      expect(participant.userId).toBeDefined();
    }
  });

  // The guest's own row follows the same rule: a cancelled enrollment is
  // re-entered on the same row, a confirmed one is refused.
  const guestRowId = await enroll("gary@example.test");
  await expectRefusal(
    enroll("gary@example.test"),
    "This player is already registered",
  );
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: guestRowId,
  });
  expect(await enroll("gary@example.test")).toBe(guestRowId);
  expect(await getRegistration(t, guestRowId)).toMatchObject({
    entryStatus: "confirmed",
    organizerLabel: "gary@example.test",
  });
  expect(
    await auditEventsOfType(t, tournamentId, "player_enrolled"),
  ).toHaveLength(3);
});

test("enrollment keeps the lifecycle, capacity, and organizer gates", async () => {
  const t = createConvexTest();
  const { tournamentId, organizationId } = await seedOpenTournament(t, {
    playerCapacity: 2,
  });
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.tournaments.registrations.addGuest, {
    tournamentId,
    displayName: "One",
  });
  const twoId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: "two@example.test" },
  );
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId,
      email: "three@example.test",
    }),
    "Tournament is at capacity",
  );
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.addGuest, {
      tournamentId,
      displayName: "Three",
    }),
    "Tournament is at capacity",
  );
  // The refused enrollments left no Guest behind.
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
    organizer.mutation(api.tournaments.registrations.addGuest, {
      tournamentId: unpublished,
      displayName: "Early",
    }),
    "Tournament is not open for registration",
  );
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId: unpublished,
      email: "early@example.test",
    }),
    "Tournament is not open for registration",
  );

  // Only organizers enroll or name.
  await insertPlayerUser(t, 9);
  const intruder = t.withIdentity(playerIdentity(9));
  await expect(
    intruder.mutation(api.tournaments.registrations.addGuest, {
      tournamentId,
      displayName: "Intruder",
    }),
  ).rejects.toThrow();
  await expect(
    intruder.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId,
      email: "intruder@example.test",
    }),
  ).rejects.toThrow();
  await expect(
    intruder.mutation(api.tournaments.registrations.continueAsGuest, {
      registrationId: twoId,
      displayName: "Intruder",
    }),
  ).rejects.toThrow();
  expect((await getRegistration(t, twoId))?.playerName).toBeUndefined();
});

test("enrollment validates the name and the email", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);

  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.addGuest, {
      tournamentId,
      displayName: "   ",
    }),
    "Enter the player's name",
  );
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.addGuest, {
      tournamentId,
      displayName: "x".repeat(81),
    }),
    "Player name must be 80 characters or fewer",
  );
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId,
      email: "   ",
    }),
    "Enter the player's email address",
  );
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId,
      email: "not-an-email",
    }),
    "Enter a valid email address",
  );
  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: "valid@example.test" },
  );
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.continueAsGuest, {
      registrationId,
      displayName: "  ",
    }),
    "Enter the player's name",
  );
  await expectRefusal(
    organizer.mutation(api.tournaments.registrations.continueAsGuest, {
      registrationId,
      displayName: "x".repeat(81),
    }),
    "Player name must be 80 characters or fewer",
  );
  // Nothing refused left a mark: the entry still awaits its name.
  expect(
    (await getRegistration(t, registrationId))?.playerName,
  ).toBeUndefined();
});

test("enrollment is the admission decision: a seat even under approval mode", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t, {
    requiresApproval: true,
  });
  const organizer = t.withIdentity(organizerIdentity);

  const guestId = await organizer.mutation(
    api.tournaments.registrations.addGuest,
    { tournamentId, displayName: "Vouched" },
  );
  const emailId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: "vouched@example.test" },
  );

  for (const registrationId of [guestId, emailId]) {
    const registration = await getRegistration(t, registrationId);
    expect(registration).toMatchObject({
      entryStatus: "confirmed",
      participationStatus: "active",
    });
    expect(registration?.awaitingReview).toBeUndefined();
  }
  expect(
    await organizer.query(api.tournaments.registrations.getPendingReviewCount, {
      tournamentId,
    }),
  ).toMatchObject({ count: 0 });
  expect(await confirmedCount(t, tournamentId)).toBe(2);
});

test("on a paid event an enrolled entry is seated, reseated, and re-admitted without an order", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t, { entryFeeCents: 2000 });
  const organizer = t.withIdentity(organizerIdentity);

  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: "carl@example.test" },
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

test("an enrollment's fee exemption survives the Claim, for a new account and an existing one", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t, { entryFeeCents: 2000 });
  const organizer = t.withIdentity(organizerIdentity);
  const newAccountEntry = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: "carl@example.test" },
  );
  await insertPlayerUser(t, 1);
  const existingAccountEntry = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: playerIdentity(1).email },
  );

  // Carl creates his account by signing in; Player 1 just opens the app.
  await t
    .withIdentity(guestIdentity("carl@example.test", "Carl"))
    .mutation(api.users.upsertMe, {});
  await t.withIdentity(playerIdentity(1)).mutation(api.users.upsertMe, {});

  for (const registrationId of [newAccountEntry, existingAccountEntry]) {
    const participant = await t.run(async (ctx) => {
      const registration = await ctx.db.get(registrationId);
      return await ctx.db.get(registration!.participantId);
    });
    expect(participant?.userId).toBeDefined();
    await organizer.mutation(api.tournaments.registrations.dropRegistration, {
      registrationId,
    });
    await organizer.mutation(
      api.tournaments.registrations.reinstateRegistration,
      { registrationId },
    );
    expect(await getRegistration(t, registrationId)).toMatchObject({
      entryStatus: "confirmed",
      participationStatus: "active",
      entryFeeExempt: true,
    });
    await organizer.mutation(api.tournaments.registrations.rejectRegistration, {
      registrationId,
    });
    await organizer.mutation(
      api.tournaments.registrations.approveRegistration,
      { registrationId },
    );
    expect(await getRegistration(t, registrationId)).toMatchObject({
      entryStatus: "confirmed",
    });
  }
  expect(await orderCount(t)).toBe(0);
  expect(
    await auditEventsOfType(t, tournamentId, "payment_requested"),
  ).toHaveLength(0);
});

test("a player's own re-entry drops the enrollment's fee exemption", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t, {
    entryFeeCents: 2000,
    requiresApproval: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  await insertPlayerUser(t, 1);
  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: playerIdentity(1).email },
  );
  const player = t.withIdentity(playerIdentity(1));
  // Cancelling is an authenticated action, so it claims the entry first.
  await player.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  await player.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId,
  });
  expect(
    (await getRegistration(t, registrationId))?.entryFeeExempt,
  ).toBeUndefined();

  await organizer.mutation(api.tournaments.registrations.approveRegistration, {
    registrationId,
  });
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "pending",
  });
  expect(await orderCount(t)).toBe(1);
});

test("the same email across events reuses one Guest with a name per event, and one Claim takes them all", async () => {
  const t = createConvexTest();
  const { tournamentId: first, organizationId } = await seedOpenTournament(t);
  const second = await createOpenTournament(t, organizationId, "Second");
  const organizer = t.withIdentity(organizerIdentity);

  const firstId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId: first, email: "gary@example.test" },
  );
  const secondId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId: second, email: "GARY@Example.test" },
  );
  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId: firstId,
    displayName: "Gary",
  });
  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId: secondId,
    displayName: "Gary G.",
  });

  const guestId = await t.run(async (ctx) => {
    const firstRow = await ctx.db.get(firstId);
    const secondRow = await ctx.db.get(secondId);
    expect(secondRow?.participantId).toBe(firstRow?.participantId);
    const guest = await ctx.db.get(firstRow!.participantId);
    // Each event shows the name its own organizer action gave the row; the
    // shared guest is never renamed.
    expect(guest?.displayName).toBeUndefined();
    expect(guest?.contactEmail).toBe("gary@example.test");
    expect(firstRow?.playerName).toBe("Gary");
    expect(secondRow?.playerName).toBe("Gary G.");
    expect((await publicIdentityForRegistration(ctx, firstId)).name).toBe(
      "Gary",
    );
    expect((await publicIdentityForRegistration(ctx, secondId)).name).toBe(
      "Gary G.",
    );
    return guest!._id;
  });

  const gary = t.withIdentity(guestIdentity("Gary@Example.TEST", "Gary Guest"));
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

test("adding guests by name always creates fresh Guests, which no sign-in claims", async () => {
  const t = createConvexTest();
  const { tournamentId: first, organizationId } = await seedOpenTournament(t);
  const second = await createOpenTournament(t, organizationId, "Second");
  const organizer = t.withIdentity(organizerIdentity);

  const firstId = await organizer.mutation(
    api.tournaments.registrations.addGuest,
    { tournamentId: first, displayName: "Sam" },
  );
  const secondId = await organizer.mutation(
    api.tournaments.registrations.addGuest,
    { tournamentId: second, displayName: "Sam" },
  );
  await t
    .withIdentity(guestIdentity("sam@example.test", "Sam"))
    .mutation(api.users.upsertMe, {});

  await t.run(async (ctx) => {
    const firstRow = await ctx.db.get(firstId);
    const secondRow = await ctx.db.get(secondId);
    expect(secondRow?.participantId).not.toBe(firstRow?.participantId);
    for (const row of [firstRow, secondRow]) {
      const guest = await ctx.db.get(row!.participantId);
      expect(guest?.userId).toBeUndefined();
    }
  });
});

test("a Claim collision leaves both entries in one event separate, and the guest's entry can still be named", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  // Two cached accounts still share an address (neither has signed in since
  // the provider moved it), so the enrollment cannot tell whose row to
  // check and seats a Guest — alongside the row one of them already holds.
  await t.run(async (ctx) => {
    for (const subject of ["dup-a", "dup-b"]) {
      await ctx.db.insert("users", {
        tokenIdentifier: `https://convex.test|${subject}`,
        publicCode: subject === "dup-a" ? 50 : 51,
        email: "shared@example.test",
        name: subject === "dup-a" ? "Dup A" : "Dup B",
        updatedAt: Date.now(),
      });
    }
  });
  const dupA = {
    issuer: "https://convex.test",
    subject: "dup-a",
    tokenIdentifier: "https://convex.test|dup-a",
    email: "shared@example.test",
    name: "Dup A",
  };
  const accountRow = await t
    .withIdentity(dupA)
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
  // Signing in released the address from dup-b; re-seed the stale copy to
  // reproduce the ambiguous cache the enrollment then sees.
  await t.run(async (ctx) => {
    const dupB = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", "https://convex.test|dup-b"),
      )
      .unique();
    await ctx.db.patch(dupB!._id, { email: "shared@example.test" });
  });
  const guestRow = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: "shared@example.test" },
  );
  expect(guestRow).not.toBe(accountRow);
  expect(await confirmedCount(t, tournamentId)).toBe(2);

  // Dup A signs in: the guest would collide with their own row, so it stays
  // a separate, unclaimed entry — nothing merged, nothing discarded.
  await t.withIdentity(dupA).mutation(api.users.upsertMe, {});
  const guestRegistration = await getRegistration(t, guestRow);
  await t.run(async (ctx) => {
    const guest = await ctx.db.get(guestRegistration!.participantId);
    expect(guest?.userId).toBeUndefined();
    expect(guest?.contactEmail).toBe("shared@example.test");
  });
  expect(await confirmedCount(t, tournamentId)).toBe(2);
  const roster = await organizerRegistrationRows(t, tournamentId);
  expect(
    roster.map((row) => [row.playerName, row.awaitingPlayerDetails]).sort(),
  ).toEqual([
    ["Dup A", false],
    ["shared@example.test", true],
  ]);

  // The organizer resolves the duplicate explicitly: name the second entry
  // (a second entrant after all) or remove it — both are ordinary actions.
  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId: guestRow,
    displayName: "Second Entrant",
  });
  expect(await getRegistration(t, guestRow)).toMatchObject({
    playerName: "Second Entrant",
    organizerNamed: true,
  });
});

test("the Claim follows the account that holds the email now, not a stale cached copy", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  // Player 1's account still caches player1@ although, at the provider,
  // they moved to another address and a new account took it.
  const formerHolder = await insertPlayerUser(t, 1);
  const newHolder = t.withIdentity({
    issuer: "https://convex.test",
    subject: "new-holder",
    tokenIdentifier: "https://convex.test|new-holder",
    email: playerIdentity(1).email,
    name: "New Holder",
  });
  const newHolderId = await newHolder.mutation(api.users.upsertMe, {});
  await t.run(async (ctx) => {
    expect((await ctx.db.get(formerHolder))?.email).toBeUndefined();
  });

  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: playerIdentity(1).email },
  );
  // The former holder's app use claims nothing: their verified email is now
  // another address.
  await t
    .withIdentity({ ...playerIdentity(1), email: "moved@example.test" })
    .mutation(api.users.upsertMe, {});
  expect(
    await t.run(async (ctx) => {
      const registration = await ctx.db.get(registrationId);
      return (await ctx.db.get(registration!.participantId))?.userId ?? null;
    }),
  ).toBeNull();
  await newHolder.mutation(api.users.upsertMe, {});
  await t.run(async (ctx) => {
    const registration = await ctx.db.get(registrationId);
    const participant = await ctx.db.get(registration!.participantId);
    expect(participant?.userId).toBe(newHolderId);
    expect(registration?.playerName).toBe("New Holder");
  });
});

test("a player's own registration into an event they were enrolled in takes over the enrolled entry", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: playerIdentity(1).email },
  );

  // Registering is the first thing the player does signed in: the sign-in's
  // Claim hands them the enrolled entry, and the registration is that entry
  // — not a refusal, which would roll the Claim back with it.
  const player = t.withIdentity(playerIdentity(1));
  expect(
    await player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).toBe(registrationId);
  expect(
    await player.query(api.tournaments.registrations.getMyRegistration, {
      tournamentId,
    }),
  ).toMatchObject({
    _id: registrationId,
    entryStatus: "confirmed",
    participationStatus: "active",
    entryFeeExempt: true,
    playerName: "Player 1",
  });
  expect(await confirmedCount(t, tournamentId)).toBe(1);
  expect(await organizerRegistrationRows(t, tournamentId)).toHaveLength(1);
  // Nothing was filed: the roster saw an enrollment, never a registration.
  expect(
    await auditEventsOfType(t, tournamentId, "player_registered"),
  ).toHaveLength(0);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("participants").collect()).toHaveLength(1);
  });

  // Holding the seat, a second attempt is the ordinary refusal.
  await expectRefusal(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
    "Already registered",
  );
});

test("a player registering into an event where a guest the Claim could not merge holds their entry takes that entry, never a second seat", async () => {
  const t = createConvexTest();
  const { tournamentId: shared, organizationId } = await seedOpenTournament(t);
  const enrolledIn = await createOpenTournament(t, organizationId, "Enrolled");
  const cancelledIn = await createOpenTournament(
    t,
    organizationId,
    "Cancelled",
  );
  const organizer = t.withIdentity(organizerIdentity);
  const enroll = (tournamentId: Id<"tournaments">) =>
    organizer.mutation(api.tournaments.registrations.enrollPlayer, {
      tournamentId,
      email: playerIdentity(1).email,
    });
  // One Guest, enrolled in three events: seated in two, and in the third
  // named for the event and then removed.
  const sharedGuestRow = await enroll(shared);
  const enrolledRow = await enroll(enrolledIn);
  const cancelledRow = await enroll(cancelledIn);
  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId: cancelledRow,
    displayName: "Event Alias",
  });
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: cancelledRow,
  });
  const guestId = (await getRegistration(t, sharedGuestRow))!.participantId;
  // The account holds its own entry in the shared event beside the guest's
  // — the collision that keeps the guest whole and unclaimed at sign-in.
  const userId = await insertPlayerUser(t, 1);
  const accountSharedRow = await rawSeed(
    t,
    "a Claim collision: the account's own entry in an event the guest is also entered in, which no public write files beside a guest carrying the account's email",
    async (ctx) => {
      const tournament = (await ctx.db.get(shared))!;
      const participantId = await insertLinkedParticipant(ctx, userId);
      const now = Date.now();
      const registrationId = await ctx.db.insert("tournamentRegistrations", {
        tournamentId: shared,
        participantId,
        tournamentStartDate: tournament.startDate,
        entryStatus: "confirmed",
        participationStatus: "active",
        playerName: "Player 1",
        organizerLabel: "Player 1",
        createdAt: now,
        tiebreakRandom: 1,
        updatedAt: now,
      });
      await ctx.db.patch(shared, {
        confirmedRegistrationCount: tournament.confirmedRegistrationCount + 1,
      });
      return registrationId;
    },
  );
  const player = t.withIdentity(playerIdentity(1));
  await player.mutation(api.users.upsertMe, {});
  expect((await getRegistration(t, enrolledRow))?.participantId).toBe(guestId);

  // The seat the organizer enrolled is the player's registration there.
  expect(
    await player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId: enrolledIn,
    }),
  ).toBe(enrolledRow);
  const claimedSeat = await getRegistration(t, enrolledRow);
  expect(claimedSeat).toMatchObject({
    entryStatus: "confirmed",
    entryFeeExempt: true,
    playerName: "Player 1",
  });
  expect(claimedSeat?.participantId).not.toBe(guestId);
  expect(await confirmedCount(t, enrolledIn)).toBe(1);
  expect(await organizerRegistrationRows(t, enrolledIn)).toHaveLength(1);

  // The removed entry is re-entered the same way a cancelled row of the
  // account's own would be: on the player's terms and under their name.
  expect(
    await player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId: cancelledIn,
    }),
  ).toBe(cancelledRow);
  const reentered = await getRegistration(t, cancelledRow);
  expect(reentered).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
    playerName: "Player 1",
    organizerLabel: "Player 1",
  });
  expect(reentered?.entryFeeExempt).toBeUndefined();
  expect(reentered?.organizerNamed).toBeUndefined();
  expect(reentered?.participantId).toBe(claimedSeat?.participantId);
  expect(await confirmedCount(t, cancelledIn)).toBe(1);
  expect(await organizerRegistrationRows(t, cancelledIn)).toHaveLength(1);

  // The shared event keeps both entrants, and the guest with its one entry.
  expect((await getRegistration(t, sharedGuestRow))?.participantId).toBe(
    guestId,
  );
  expect((await getRegistration(t, accountSharedRow))?.participantId).toBe(
    claimedSeat?.participantId,
  );
  expect(await confirmedCount(t, shared)).toBe(2);
  await t.run(async (ctx) => {
    expect((await ctx.db.get(guestId))?.contactEmail).toBe(
      playerIdentity(1).email,
    );
  });
});

test("an organizer's name for an entry ends with the entry: an account holder's cancellation or re-entry drops it for the account's name", async () => {
  const t = createConvexTest();
  const { tournamentId, organizationId } = await seedOpenTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: playerIdentity(1).email },
  );
  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId,
    displayName: "Event Alias",
  });
  const player = t.withIdentity(playerIdentity(1));
  await player.mutation(api.users.upsertMe, {});
  expect(await getRegistration(t, registrationId)).toMatchObject({
    playerName: "Event Alias",
    organizerNamed: true,
  });

  // Cancelling the claimed entry drops the event's label: the entry is an
  // account holder's now, labelled by the account.
  await player.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  const cancelled = await getRegistration(t, registrationId);
  expect(cancelled).toMatchObject({
    entryStatus: "cancelled",
    playerName: "Player 1",
    organizerLabel: "Player 1",
  });
  expect(cancelled?.organizerNamed).toBeUndefined();

  // Re-entering keeps it that way, and the account's later rename reaches
  // the entry like any of the account's rows — it is no longer frozen.
  await player.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId,
  });
  const reentered = await getRegistration(t, registrationId);
  expect(reentered).toMatchObject({
    entryStatus: "confirmed",
    playerName: "Player 1",
  });
  expect(reentered?.organizerNamed).toBeUndefined();
  const renamed = t.withIdentity({
    ...playerIdentity(1),
    name: "Updated Profile Name",
  });
  await renamed.mutation(api.users.upsertMe, {});
  expect(await getRegistration(t, registrationId)).toMatchObject({
    playerName: "Updated Profile Name",
    organizerLabel: "Updated Profile Name",
  });

  // The organizer's own removal of an account holder's named entry drops
  // the label the same way, so reinstating seats the account under its name.
  const second = await createOpenTournament(t, organizationId, "Second");
  const secondId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId: second, email: playerIdentity(1).email },
  );
  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId: secondId,
    displayName: "Second Alias",
  });
  await renamed.mutation(api.users.upsertMe, {});
  expect((await getRegistration(t, secondId))?.playerName).toBe("Second Alias");
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: secondId,
  });
  expect(await getRegistration(t, secondId)).toMatchObject({
    entryStatus: "cancelled",
    playerName: "Updated Profile Name",
  });
  expect((await getRegistration(t, secondId))?.organizerNamed).toBeUndefined();
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    { registrationId: secondId },
  );
  expect(await getRegistration(t, secondId)).toMatchObject({
    entryStatus: "confirmed",
    playerName: "Updated Profile Name",
  });

  // A Guest's cancelled entry keeps the name it was given — it has no
  // other — and the Claim that hands a cancelled entry to an account gives
  // it the account's name rather than carrying the label over.
  const third = await createOpenTournament(t, organizationId, "Third");
  const thirdId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId: third, email: "gary@example.test" },
  );
  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId: thirdId,
    displayName: "Gary G.",
  });
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: thirdId,
  });
  expect(await getRegistration(t, thirdId)).toMatchObject({
    entryStatus: "cancelled",
    playerName: "Gary G.",
    organizerNamed: true,
  });
  await t
    .withIdentity(guestIdentity("gary@example.test", "Garrett"))
    .mutation(api.users.upsertMe, {});
  const claimedCancelled = await getRegistration(t, thirdId);
  expect(claimedCancelled).toMatchObject({
    entryStatus: "cancelled",
    playerName: "Garrett",
    organizerLabel: "Garrett",
  });
  expect(claimedCancelled?.organizerNamed).toBeUndefined();
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
  options: { playerMeeting?: boolean } = {},
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
      phases: [
        {
          phaseOrder: 1,
          phaseRoundMode: "dynamic",
          ...(options.playerMeeting ? { playerMeeting: true } : {}),
        },
      ],
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  return tournamentId;
}

async function firstPhaseId(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
): Promise<Id<"tournamentPhases">> {
  const { phases } = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.lifecycle.getTournamentSetup, { tournamentId });
  return phases[0]._id;
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
  // Oldest first, so a test's enrollment order is the row order.
  return [...page.page].reverse();
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
