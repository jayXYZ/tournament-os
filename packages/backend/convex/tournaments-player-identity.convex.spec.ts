/// <reference types="vite/client" />

import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { UserError } from "./model/errors";
import { ACCOUNT_NAME_REQUIRED } from "./model/users";
import schema from "./schema";
import {
  organizerIdentity,
  playOutCurrentRound,
  playerIdentity,
  rejection,
  seedTournamentWithPlayers,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

// An account always has a name (schema users.name, model/users.ts
// upsertUser): a first sign-in without one is refused, and a later sign-in
// without one keeps the stored name, so no entry in play ever loses its
// player-safe name. The only nameless entry is one an organizer enrolled by
// email that nobody has named yet (CONTEXT.md "Awaiting Player Details"):
// organizer surfaces label it by the email, player-facing surfaces show
// nothing for it, and play cannot start until it is named.
const NANCY_EMAIL = "nancy@example.test";
// Nancy's account signing in with the name claim missing...
const nancyWithoutName = {
  issuer: "https://convex.test",
  subject: "nancy",
  tokenIdentifier: "https://convex.test|nancy",
  email: NANCY_EMAIL,
};
// ...and with it.
const nancyIdentity = { ...nancyWithoutName, name: "Nancy" };
const ENROLLED_EMAIL = "enrolled@example.test";

test("a first sign-in without a name is refused and files no account", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Refused Sign-in Event",
    playerCount: 1,
  });
  // A missing name claim and a blank one are the same thing.
  for (const signIn of [nancyWithoutName, { ...nancyWithoutName, name: " " }]) {
    const refusal = await rejection(
      t.withIdentity(signIn).mutation(api.users.upsertMe, {}),
    );
    expect(refusal).toBeInstanceOf(UserError);
    expect(refusal).toMatchObject({ data: ACCOUNT_NAME_REQUIRED });
    // Every authenticated verb signs the caller in the same way first.
    await expect(
      t
        .withIdentity(signIn)
        .mutation(api.tournaments.registrations.registerSelf, { tournamentId }),
    ).rejects.toThrow(ACCOUNT_NAME_REQUIRED);
  }
  expect(await userRowFor(t, nancyWithoutName)).toBeNull();

  // The account is filed the moment a sign-in carries a name.
  await t.withIdentity(nancyIdentity).mutation(api.users.upsertMe, {});
  expect((await userRowFor(t, nancyIdentity))?.name).toBe("Nancy");
});

test("a sign-in without a name keeps the account's name everywhere it is stamped", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Kept Name Event",
    playerCount: 3,
    phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
  });
  const organizer = t.withIdentity(organizerIdentity);
  const registrationId = await t
    .withIdentity(nancyIdentity)
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const stamped = await t.run(async (ctx) => await ctx.db.get(registrationId));

  // The provider stops supplying the claim once play is under way — the
  // one way a name could have left an entry in play. The sign-in keeps the
  // stored name and touches no registration row.
  for (const signIn of [nancyWithoutName, { ...nancyWithoutName, name: "" }]) {
    await t.withIdentity(signIn).mutation(api.users.upsertMe, {});
    expect((await userRowFor(t, signIn))?.name).toBe("Nancy");
    const registration = await t.run(
      async (ctx) => await ctx.db.get(registrationId),
    );
    expect(registration).toMatchObject({
      playerName: "Nancy",
      organizerLabel: "Nancy",
      updatedAt: stamped?.updatedAt,
    });
  }

  await playOutCurrentRound(t, tournamentId);
  const standings = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getLatestStandings, { tournamentId });
  expect(JSON.stringify(standings)).not.toContain(NANCY_EMAIL);
  expect(
    standings?.rows
      .map((row) => row.name)
      .sort((a, b) => (a ?? "").localeCompare(b ?? "")),
  ).toEqual(["Nancy", "Player 1", "Player 2", "Player 3"]);
  const roster = await organizer.query(
    api.tournaments.registrations.listRegistrationPage,
    { tournamentId, paginationOpts: { numItems: 10, cursor: null } },
  );
  expect(
    roster.page.find((row) => row.registration._id === registrationId)
      ?.playerName,
  ).toBe("Nancy");
  const round = await currentRound(t, tournamentId);
  const organizerStandings = await organizer.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: round },
  );
  expect(
    organizerStandings.find(
      ({ standing }) => standing.playerId === registrationId,
    )?.playerName,
  ).toBe("Nancy");
});

test("a player meeting waits for an entry enrolled by email until it is named, and seats the name the organizer gives", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Unnamed Meeting Event",
    playerCount: 1,
    phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true }],
  });
  const organizer = t.withIdentity(organizerIdentity);
  const enrolledRegistrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: ENROLLED_EMAIL },
  );
  const phaseId = await firstPhaseId(t, tournamentId);
  // The seating sheet is the first thing players read about each other, so
  // no seat is drawn while an entrant has nothing to print but an email.
  await expect(
    organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
      phaseId,
    }),
  ).rejects.toThrow("1 player needs a name before play can start");

  // The organizer names the entry for this event, and the meeting seats it.
  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId: enrolledRegistrationId,
    displayName: "Table Guest",
  });
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId,
  });

  const view = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
  expect(view.kind).toBe("player_meeting");
  expect(JSON.stringify(view)).not.toContain(ENROLLED_EMAIL);
  if (view.kind === "player_meeting") {
    expect(view.meeting.tableNumber).toBe(1);
    expect(view.meeting.seatmateName).toBe("Table Guest");
  }
  const seating = await organizer.query(
    api.tournaments.playerMeeting.listPlayerMeetingSeats,
    { phaseId },
  );
  expect(seating.seats.map((seat) => seat.playerName).sort()).toEqual([
    "Player 1",
    "Table Guest",
  ]);
});

test("the organizer audit log labels an entry enrolled by email by that email", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Unnamed Audit Event",
    playerCount: 2,
  });
  const organizer = t.withIdentity(organizerIdentity);
  const enrolledRegistrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: ENROLLED_EMAIL },
  );
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: enrolledRegistrationId,
  });

  // The stored rows carry the organizer label — the email — resolved once at
  // append time (the log is organizer-only), so the list query never reads
  // through to the registration...
  const stored = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("tournamentAuditEvents")
        .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
        .collect()
    ).map((row) => row.event),
  );
  const storedNames = stored.flatMap((event) =>
    "player" in event && event.player.registrationId === enrolledRegistrationId
      ? [event.player.playerName]
      : [],
  );
  expect(storedNames).toEqual([ENROLLED_EMAIL, ENROLLED_EMAIL]);

  // ...and the organizer-only list returns the rows as stored.
  const page = await organizer.query(api.tournaments.auditLog.listAuditEvents, {
    tournamentId,
    paginationOpts: { numItems: 20, cursor: null },
  });
  const labelled = page.page.flatMap(({ event }) =>
    "player" in event && event.player.registrationId === enrolledRegistrationId
      ? [`${event.type}:${event.player.playerName}`]
      : [],
  );
  expect(labelled).toEqual([
    `registration_cancelled:${ENROLLED_EMAIL}`,
    `player_enrolled:${ENROLLED_EMAIL}`,
  ]);
});

test("the organizer roster search finds an entry enrolled by email by that email", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Unnamed Search Event",
    playerCount: 2,
  });
  const organizer = t.withIdentity(organizerIdentity);
  const enrolledRegistrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: ENROLLED_EMAIL },
  );

  // The search index is over the organizer label, which stamps the email
  // for an entry nobody has named — so the row the roster labels by email
  // is also the row the search finds by it.
  const byEmail = await organizer.query(
    api.tournaments.registrations.searchRegistrations,
    { tournamentId, search: ENROLLED_EMAIL },
  );
  expect(byEmail.map((row) => [row.registration._id, row.playerName])).toEqual([
    [enrolledRegistrationId, ENROLLED_EMAIL],
  ]);
  // Named rows are found by name exactly as before.
  const byName = await organizer.query(
    api.tournaments.registrations.searchRegistrations,
    { tournamentId, search: "Player 2" },
  );
  expect(byName.map((row) => row.playerName)).toContain("Player 2");

  // The stored row carries the email only in the organizer label; the
  // player-safe stamp (the one copied onto standings and seats) is absent.
  const stored = await t.run(
    async (ctx) => await ctx.db.get(enrolledRegistrationId),
  );
  expect(stored?.playerName).toBeUndefined();
  expect(stored?.organizerLabel).toBe(ENROLLED_EMAIL);
});

test("a name changed at sign-in reaches the standings and roster, and an unchanged sign-in touches no row", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Renamed Standings Event",
    playerCount: 3,
    phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 2 }],
  });
  const organizer = t.withIdentity(organizerIdentity);
  const registrationId = await t
    .withIdentity(nancyIdentity)
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  // The player-facing rows carry no registration id, so Nancy's row is
  // picked out by the rank its stored standings row holds.
  const nancyRank = await t.run(async (ctx) => {
    const [row] = await ctx.db
      .query("roundStandings")
      .withIndex("by_playerId", (q) => q.eq("playerId", registrationId))
      .order("desc")
      .take(1);
    return row!.rank;
  });
  const standingsNameFor = async (viewer: { tokenIdentifier: string }) => {
    const standings = await t
      .withIdentity(viewer)
      .query(api.tournaments.player.getLatestStandings, { tournamentId });
    const row = standings?.rows.find(
      (candidate) => candidate.rank === nancyRank,
    );
    expect(row?.isMe).toBe(
      viewer.tokenIdentifier === nancyIdentity.tokenIdentifier,
    );
    return row?.name;
  };
  const rosterNameFor = async () => {
    const roster = await organizer.query(
      api.tournaments.registrations.listRegistrationPage,
      { tournamentId, paginationOpts: { numItems: 10, cursor: null } },
    );
    return roster.page.find((row) => row.registration._id === registrationId)
      ?.playerName;
  };
  expect(await standingsNameFor(playerIdentity(1))).toBe("Nancy");
  expect(await standingsNameFor(nancyIdentity)).toBe("Nancy");
  expect(await rosterNameFor()).toBe("Nancy");

  // The provider supplies a new name. The sign-in re-stamps the
  // registration and the latest completed round's standings row, so the
  // player-facing standings — which never read through — show the name
  // without waiting for another round to complete.
  const renamed = { ...nancyIdentity, name: "Nancy Renamed" };
  await t.withIdentity(renamed).mutation(api.users.upsertMe, {});
  expect(await standingsNameFor(playerIdentity(1))).toBe("Nancy Renamed");
  expect(await standingsNameFor(renamed)).toBe("Nancy Renamed");
  expect(await rosterNameFor()).toBe("Nancy Renamed");
  const restamped = await t.run(
    async (ctx) => await ctx.db.get(registrationId),
  );
  expect(restamped?.playerName).toBe("Nancy Renamed");
  expect(restamped?.organizerLabel).toBe("Nancy Renamed");

  // An unchanged sign-in, and one without the name claim, touch no
  // registration row.
  for (const signIn of [renamed, nancyWithoutName]) {
    await t.withIdentity(signIn).mutation(api.users.upsertMe, {});
    expect(
      (await t.run(async (ctx) => await ctx.db.get(registrationId)))?.updatedAt,
    ).toBe(restamped?.updatedAt);
  }
  expect(await standingsNameFor(playerIdentity(1))).toBe("Nancy Renamed");
  expect(await rosterNameFor()).toBe("Nancy Renamed");
});

test("the organizer seating list is alphabetical by the name it prints, an organizer-given name included", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Named Seating Event",
    playerCount: 2,
    phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true }],
  });
  const organizer = t.withIdentity(organizerIdentity);
  // An entry enrolled by email that the organizer names for this event; the
  // name sorts after every other player, so the sheet files it last.
  const zedEmail = "zed@example.test";
  const zedRegistrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: zedEmail },
  );
  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId: zedRegistrationId,
    displayName: "Zed",
  });
  const phaseId = await firstPhaseId(t, tournamentId);
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId,
  });

  const seating = await organizer.query(
    api.tournaments.playerMeeting.listPlayerMeetingSeats,
    { phaseId },
  );
  expect(
    seating.seats.map((seat) => [seat.tableNumber, seat.playerName]),
  ).toEqual([
    [1, "Player 1"],
    [1, "Player 2"],
    [2, "Zed"],
  ]);
  // The seat rows carry the player-safe name, and the enrollment email
  // reaches no seat and no seatmate.
  const storedSeats = await t.run(
    async (ctx) =>
      await ctx.db
        .query("playerMeetingSeats")
        .withIndex("by_tournamentPhaseId_and_tableNumber", (q) =>
          q.eq("tournamentPhaseId", phaseId),
        )
        .collect(),
  );
  expect(storedSeats.map((seat) => seat.playerName)).toEqual([
    "Player 1",
    "Player 2",
    "Zed",
  ]);
  const view = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
  expect(JSON.stringify(view)).not.toContain(zedEmail);
  expect(view.kind).toBe("player_meeting");
  if (view.kind === "player_meeting") {
    expect(view.meeting.tableNumber).toBe(1);
    expect(view.meeting.seatmateName).toBe("Player 2");
  }
});

async function userRowFor(
  t: TestConvex<typeof schema>,
  identity: { tokenIdentifier: string },
) {
  return await t.run(
    async (ctx) =>
      await ctx.db
        .query("users")
        .withIndex("by_tokenIdentifier", (q) =>
          q.eq("tokenIdentifier", identity.tokenIdentifier),
        )
        .unique(),
  );
}

async function currentRound(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const round = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.rounds.getCurrentRound, { tournamentId });
  if (!round) {
    throw new Error("No current round in test setup");
  }
  return round._id;
}

async function firstPhaseId(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  return await t.run(async (ctx) => {
    const phase = await ctx.db
      .query("tournamentPhases")
      .withIndex("by_tournamentId_and_phaseOrder", (q) =>
        q.eq("tournamentId", tournamentId).eq("phaseOrder", 1),
      )
      .unique();
    if (!phase) {
      throw new Error("Phase missing in test setup");
    }
    return phase._id;
  });
}
