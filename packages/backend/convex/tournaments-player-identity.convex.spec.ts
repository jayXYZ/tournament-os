/// <reference types="vite/client" />

import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  matchForPlayer,
  opponentNumber,
  organizerIdentity,
  playOutCurrentRound,
  playerIdentity,
  seedOrganizer,
  seedTournamentWithPlayers,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

// A sign-in whose provider supplied no display name: the account carries an
// email and nothing else. Player-facing surfaces must show other players
// nothing for this account rather than its email (model/participants.ts
// participantPublicIdentity); organizer surfaces may keep the email as the
// roster's fallback label.
const NAMELESS_EMAIL = "nameless@example.test";
const namelessIdentity = {
  issuer: "https://convex.test",
  subject: "nameless",
  tokenIdentifier: "https://convex.test|nameless",
  email: NAMELESS_EMAIL,
};

test("standings never show another player's email in place of a missing name", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Nameless Standings Event",
    playerCount: 3,
    phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
    playerNames: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  // Registers through the real sign-in + registration path, so the name
  // denormalized onto the registration (and from there onto standings) is
  // exactly what production would stamp.
  const namelessRegistrationId = await t
    .withIdentity(namelessIdentity)
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });

  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  const standings = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getLatestStandings, { tournamentId });
  expect(standings?.rows).toHaveLength(4);
  expect(JSON.stringify(standings)).not.toContain(NAMELESS_EMAIL);
  expect(
    standings?.rows
      .map((row) => row.name)
      .sort((a, b) => (a ?? "").localeCompare(b ?? "")),
  ).toEqual([null, "Player 1", "Player 2", "Player 3"]);

  // The organizer's roster keeps the email as the fallback label.
  const roster = await organizer.query(
    api.tournaments.registrations.listRegistrationPage,
    { tournamentId, paginationOpts: { numItems: 10, cursor: null } },
  );
  expect(
    roster.page.find((row) => row.registration._id === namelessRegistrationId)
      ?.playerName,
  ).toBe(NAMELESS_EMAIL);
  const round = await currentRound(t, tournamentId);
  const organizerStandings = await organizer.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: round },
  );
  expect(
    organizerStandings.find(
      ({ standing }) => standing.playerId === namelessRegistrationId,
    )?.playerName,
  ).toBe(NAMELESS_EMAIL);
});

test("a player meeting never shows a seatmate's email in place of a missing name", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Nameless Meeting Event",
    playerCount: 1,
    phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true }],
    playerNames: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  await t
    .withIdentity(namelessIdentity)
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
  const phaseId = await firstPhaseId(t, tournamentId);
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId,
  });

  const view = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
  expect(view.kind).toBe("player_meeting");
  expect(JSON.stringify(view)).not.toContain(NAMELESS_EMAIL);
  if (view.kind === "player_meeting") {
    expect(view.meeting.tableNumber).toBe(1);
    expect(view.meeting.seatmateName).toBeNull();
  }

  // The organizer's seating list keeps the email as the fallback label.
  const seating = await organizer.query(
    api.tournaments.playerMeeting.listPlayerMeetingSeats,
    { phaseId },
  );
  expect(seating.seats.map((seat) => seat.playerName).sort()).toEqual([
    "Player 1",
    NAMELESS_EMAIL,
  ]);
});

test("the organizer audit log labels a nameless player by email", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Nameless Audit Event",
    playerCount: 2,
    playerNames: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  const namelessRegistrationId = await t
    .withIdentity(namelessIdentity)
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: namelessRegistrationId,
  });

  // The stored rows carry the organizer label — the email — resolved once at
  // append time (the log is organizer-only), so the list query never reads
  // through to the user document...
  const stored = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("tournamentAuditEvents")
        .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
        .collect()
    ).map((row) => row.event),
  );
  const storedNames = stored.flatMap((event) =>
    "player" in event && event.player.registrationId === namelessRegistrationId
      ? [event.player.playerName]
      : [],
  );
  expect(storedNames).toEqual([NAMELESS_EMAIL, NAMELESS_EMAIL]);

  // ...and the organizer-only list returns the rows as stored.
  const page = await organizer.query(api.tournaments.auditLog.listAuditEvents, {
    tournamentId,
    paginationOpts: { numItems: 20, cursor: null },
  });
  const labelled = page.page.flatMap(({ event }) =>
    "player" in event && event.player.registrationId === namelessRegistrationId
      ? [`${event.type}:${event.player.playerName}`]
      : [],
  );
  expect(labelled).toEqual([
    `registration_cancelled:${NAMELESS_EMAIL}`,
    `player_registered:${NAMELESS_EMAIL}`,
  ]);
});

test("the organizer roster search finds a nameless account by its email", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Nameless Search Event",
    playerCount: 2,
    playerNames: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  const namelessRegistrationId = await t
    .withIdentity(namelessIdentity)
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });

  // The search index is over the organizer label, which stamps the email
  // for an account without a name — so the row the roster labels by email
  // is also the row the search finds by it.
  const byEmail = await organizer.query(
    api.tournaments.registrations.searchRegistrations,
    { tournamentId, search: NAMELESS_EMAIL },
  );
  expect(byEmail.map((row) => [row.registration._id, row.playerName])).toEqual([
    [namelessRegistrationId, NAMELESS_EMAIL],
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
    async (ctx) => await ctx.db.get(namelessRegistrationId),
  );
  expect(stored?.playerName).toBeUndefined();
  expect(stored?.organizerLabel).toBe(NAMELESS_EMAIL);
});

test("the organizer badge search finds a nameless badge holder by email", async () => {
  const t = createConvexTest();
  const { conventionId, ticketTypeId } = await seedConvention(t);
  const organizer = t.withIdentity(organizerIdentity);
  const badgeId = await t
    .withIdentity(namelessIdentity)
    .mutation(api.conventions.registrations.registerSelfForConvention, {
      conventionId,
      ticketTypeId,
    });

  const found = await organizer.query(
    api.conventions.registrations.searchBadges,
    { conventionId, search: NAMELESS_EMAIL },
  );
  expect(found.map((row) => [row.registration._id, row.playerName])).toEqual([
    [badgeId, NAMELESS_EMAIL],
  ]);
});

test("the organizer badge roster and convention log label a nameless badge holder by email", async () => {
  const t = createConvexTest();
  const { conventionId, ticketTypeId } = await seedConvention(t);
  const organizer = t.withIdentity(organizerIdentity);
  const badgeId = await t
    .withIdentity(namelessIdentity)
    .mutation(api.conventions.registrations.registerSelfForConvention, {
      conventionId,
      ticketTypeId,
    });

  // The roster page labels the badge off the row's organizer stamp.
  const roster = await organizer.query(
    api.conventions.registrations.listBadgePage,
    { conventionId, paginationOpts: { numItems: 10, cursor: null } },
  );
  expect(
    roster.page.map((row) => [row.registration._id, row.playerName]),
  ).toEqual([[badgeId, NAMELESS_EMAIL]]);

  await organizer.mutation(api.conventions.registrations.removeBadge, {
    registrationId: badgeId,
  });

  // The holder's own append (registering) and the organizer's (removing)
  // label the badge the same way: both read the row's stamp.
  const log = await organizer.query(api.conventions.auditLog.listAuditEvents, {
    conventionId,
    paginationOpts: { numItems: 20, cursor: null },
  });
  expect(
    log.page.flatMap(({ event }) =>
      "player" in event && event.player.registrationId === badgeId
        ? [`${event.type}:${event.player.playerName}`]
        : [],
    ),
  ).toEqual([
    `badge_removed:${NAMELESS_EMAIL}`,
    `badge_registered:${NAMELESS_EMAIL}`,
  ]);
});

test("organizer pairing edits and results label a nameless player by email", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournamentWithPlayers(t, {
    name: "Nameless Pairing Edits Event",
    playerCount: 3,
    autoPublishPairings: false,
    phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
    playerNames: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  const nameless = t.withIdentity(namelessIdentity);
  const namelessRegistrationId = await nameless.mutation(
    api.tournaments.registrations.registerSelf,
    { tournamentId },
  );
  const roundId = await organizer.mutation(
    api.tournaments.rounds.startTournament,
    { tournamentId },
  );

  // The organizer pairings list resolves the nameless match-player row to
  // the email with its one registration read; named rows read nothing.
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId },
  );
  const seats = pairings.flatMap(({ players }) => players);
  expect(seats.map((seat) => seat.playerName).sort()).toEqual([
    "Player 1",
    "Player 2",
    "Player 3",
    NAMELESS_EMAIL,
  ]);
  const namelessMatch = pairings.find(({ players }) =>
    players.some((seat) => seat.playerId === namelessRegistrationId),
  )!;
  const opponentId = namelessMatch.players.find(
    (seat) => seat.playerId !== namelessRegistrationId,
  )!.playerId;
  const opponentNumber = registrationIds.indexOf(opponentId) + 1;

  // Break the pairing, bye the nameless player, break the bye, and re-pair
  // the two freed players: every edit references the nameless row.
  await organizer.mutation(api.tournaments.rounds.breakPairing, {
    matchId: namelessMatch.match._id,
  });
  const freed = await organizer.query(
    api.tournaments.rounds.listUnpairedPlayers,
    { roundId },
  );
  expect(
    freed.map((row) => [row.registrationId, row.playerName]).sort(),
  ).toEqual(
    [
      [namelessRegistrationId, NAMELESS_EMAIL],
      [opponentId, `Player ${opponentNumber}`],
    ].sort(),
  );
  const byeMatchId = await organizer.mutation(
    api.tournaments.rounds.assignBye,
    { roundId, registrationId: namelessRegistrationId },
  );
  await organizer.mutation(api.tournaments.rounds.breakPairing, {
    matchId: byeMatchId,
  });
  const matchId = await organizer.mutation(api.tournaments.rounds.pairPlayers, {
    roundId,
    playerOneRegistrationId: namelessRegistrationId,
    playerTwoRegistrationId: opponentId,
  });
  await organizer.mutation(api.tournaments.rounds.publishPairings, {
    roundId,
  });

  // The nameless player reports the result, then the organizer overrides it.
  await nameless.mutation(api.tournaments.player.reportMyMatchResult, {
    matchId,
    myGameWins: 2,
    opponentGameWins: 0,
  });
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId,
    playerOneRegistrationId: namelessRegistrationId,
    playerTwoRegistrationId: opponentId,
    playerOneGameWins: 0,
    playerTwoGameWins: 2,
  });

  // Every arm that references the row — the single-player registration
  // event, the freed/paired player lists, and both result-line arrays of
  // the override — carries the email, newest first.
  expect(await auditLabelsFor(t, tournamentId, namelessRegistrationId)).toEqual(
    [
      `match_result_recorded:${NAMELESS_EMAIL}`,
      `match_result_recorded:${NAMELESS_EMAIL}`,
      `match_result_reported:${NAMELESS_EMAIL}`,
      `pairing_created:${NAMELESS_EMAIL}`,
      `pairing_broken:${NAMELESS_EMAIL}`,
      `pairing_created:${NAMELESS_EMAIL}`,
      `pairing_broken:${NAMELESS_EMAIL}`,
      `player_registered:${NAMELESS_EMAIL}`,
    ],
  );
  // The opponent's lines in the same events are labelled by name.
  expect(await auditLabelsFor(t, tournamentId, opponentId)).toEqual([
    `match_result_recorded:Player ${opponentNumber}`,
    `match_result_recorded:Player ${opponentNumber}`,
    `match_result_reported:Player ${opponentNumber}`,
    `pairing_created:Player ${opponentNumber}`,
    `pairing_broken:Player ${opponentNumber}`,
  ]);

  // The opponent's own match card never carries the email.
  const view = await t
    .withIdentity(playerIdentity(opponentNumber))
    .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
  expect(JSON.stringify(view)).not.toContain(NAMELESS_EMAIL);
  expect(view.kind).toBe("match");
  if (view.kind === "match") {
    expect(view.opponent?.name ?? null).toBeNull();
  }
});

test("a nameless player's mid-round drop is logged as a concession labelled by email", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournamentWithPlayers(t, {
    name: "Nameless Concession Event",
    playerCount: 3,
    phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
    playerNames: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  const nameless = t.withIdentity(namelessIdentity);
  const namelessRegistrationId = await nameless.mutation(
    api.tournaments.registrations.registerSelf,
    { tournamentId },
  );
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const match = await matchForPlayer(
    t,
    tournamentId,
    1,
    namelessRegistrationId,
  );
  const opponent = await opponentNumber(
    t,
    match._id,
    namelessRegistrationId,
    registrationIds,
  );

  await nameless.mutation(api.tournaments.player.dropSelf, { tournamentId });

  // The drop and the concession it awards both label the conceding player
  // by the organizer label — on the event's player and on its result line.
  expect(await auditLabelsFor(t, tournamentId, namelessRegistrationId)).toEqual(
    [
      `match_conceded:${NAMELESS_EMAIL}`,
      `match_conceded:${NAMELESS_EMAIL}`,
      `player_dropped:${NAMELESS_EMAIL}`,
      `player_registered:${NAMELESS_EMAIL}`,
    ],
  );
  expect(
    await auditLabelsFor(t, tournamentId, registrationIds[opponent - 1]),
  ).toEqual([`match_conceded:Player ${opponent}`]);

  // The opponent sees the walkover without the conceder's email.
  const view = await t
    .withIdentity(playerIdentity(opponent))
    .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
  expect(JSON.stringify(view)).not.toContain(NAMELESS_EMAIL);
  expect(view.kind).toBe("match");
  if (view.kind === "match") {
    expect(view.opponent?.name ?? null).toBeNull();
  }
});

test("a name gained after registering reaches the standings and roster on the next sign-in", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Renamed Standings Event",
    playerCount: 3,
    phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 2 }],
    playerNames: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  const namelessRegistrationId = await t
    .withIdentity(namelessIdentity)
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  // The player-facing rows carry no registration id, so the nameless
  // player's row is picked out by the rank its stored standings row holds.
  const namelessRank = await t.run(async (ctx) => {
    const [row] = await ctx.db
      .query("roundStandings")
      .withIndex("by_playerId", (q) => q.eq("playerId", namelessRegistrationId))
      .order("desc")
      .take(1);
    return row!.rank;
  });
  const standingsNameFor = async (viewer: { tokenIdentifier: string }) => {
    const standings = await t
      .withIdentity(viewer)
      .query(api.tournaments.player.getLatestStandings, { tournamentId });
    const row = standings?.rows.find(
      (candidate) => candidate.rank === namelessRank,
    );
    expect(row?.isMe).toBe(
      viewer.tokenIdentifier === namelessIdentity.tokenIdentifier,
    );
    return row?.name;
  };
  const rosterNameFor = async () => {
    const roster = await organizer.query(
      api.tournaments.registrations.listRegistrationPage,
      { tournamentId, paginationOpts: { numItems: 10, cursor: null } },
    );
    return roster.page.find(
      (row) => row.registration._id === namelessRegistrationId,
    )?.playerName;
  };
  // Nameless at registration: the completed round's standings carry no
  // name for the row, for other players and for the player themself.
  expect(await standingsNameFor(playerIdentity(1))).toBeNull();
  expect(await standingsNameFor(namelessIdentity)).toBeNull();
  expect(await rosterNameFor()).toBe(NAMELESS_EMAIL);

  // The provider starts supplying a name. The sign-in re-stamps the
  // registration and the latest completed round's standings row, so the
  // player-facing standings — which never read through — show the name
  // without waiting for another round to complete.
  const named = { ...namelessIdentity, name: "Newly Named" };
  await t.withIdentity(named).mutation(api.users.upsertMe, {});
  expect(await standingsNameFor(playerIdentity(1))).toBe("Newly Named");
  expect(await standingsNameFor(named)).toBe("Newly Named");
  expect(await rosterNameFor()).toBe("Newly Named");
  const renamed = await t.run(
    async (ctx) => await ctx.db.get(namelessRegistrationId),
  );
  expect(renamed?.playerName).toBe("Newly Named");
  expect(renamed?.organizerLabel).toBe("Newly Named");

  // An unchanged sign-in touches no registration row.
  await t.withIdentity(named).mutation(api.users.upsertMe, {});
  expect(
    (await t.run(async (ctx) => await ctx.db.get(namelessRegistrationId)))
      ?.updatedAt,
  ).toBe(renamed?.updatedAt);

  // The provider drops the name again: the player-safe stamp is cleared
  // everywhere it was copied, and the organizer label falls back to the
  // email — the email never reaches the standings.
  await t.withIdentity(namelessIdentity).mutation(api.users.upsertMe, {});
  const standings = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getLatestStandings, { tournamentId });
  expect(JSON.stringify(standings)).not.toContain(NAMELESS_EMAIL);
  expect(await standingsNameFor(playerIdentity(1))).toBeNull();
  expect(await rosterNameFor()).toBe(NAMELESS_EMAIL);
  const unnamed = await t.run(
    async (ctx) => await ctx.db.get(namelessRegistrationId),
  );
  expect(unnamed?.playerName).toBeUndefined();
  expect(unnamed?.organizerLabel).toBe(NAMELESS_EMAIL);
});

test("a blank provider name counts as no name", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Blank Name Event",
    playerCount: 2,
    phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
    playerNames: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  // The provider supplies the name claim, but empty — what an account that
  // never filled in a name can look like. It must stamp exactly as a
  // missing name does: nothing player-safe, the email for organizers.
  const blankNamed = { ...namelessIdentity, name: "   " };
  const registrationId = await t
    .withIdentity(blankNamed)
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });

  const stored = await t.run(async (ctx) => {
    const registration = await ctx.db.get(registrationId);
    const participant = registration
      ? await ctx.db.get(registration.participantId)
      : null;
    const user = participant?.userId
      ? await ctx.db.get(participant.userId)
      : null;
    return { registration, user };
  });
  expect(stored.user?.name).toBeUndefined();
  expect(stored.registration?.playerName).toBeUndefined();
  expect(stored.registration?.organizerLabel).toBe(NAMELESS_EMAIL);

  // Organizer surfaces label the row by email, never by "".
  const roster = await organizer.query(
    api.tournaments.registrations.listRegistrationPage,
    { tournamentId, paginationOpts: { numItems: 10, cursor: null } },
  );
  expect(
    roster.page.find((row) => row.registration._id === registrationId)
      ?.playerName,
  ).toBe(NAMELESS_EMAIL);
  const page = await organizer.query(api.tournaments.auditLog.listAuditEvents, {
    tournamentId,
    paginationOpts: { numItems: 20, cursor: null },
  });
  const registered = page.page.find(
    (row) =>
      row.event.type === "player_registered" &&
      row.event.player.registrationId === registrationId,
  );
  expect(registered?.actorName).toBe(NAMELESS_EMAIL);
  expect(
    registered && "player" in registered.event
      ? registered.event.player.playerName
      : undefined,
  ).toBe(NAMELESS_EMAIL);

  // The player standings carry no name for the row (rendered as "Unknown
  // player"), not an empty string.
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);
  const standings = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getLatestStandings, { tournamentId });
  expect(JSON.stringify(standings)).not.toContain(NAMELESS_EMAIL);
  expect(
    standings?.rows
      .map((row) => row.name)
      .sort((a, b) => (a ?? "").localeCompare(b ?? "")),
  ).toEqual([null, "Player 1", "Player 2"]);
});

test("the organizer seating list is alphabetical by the label it prints", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Nameless Seating Event",
    playerCount: 2,
    phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true }],
    playerNames: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  // An email that sorts after every named player: seating by the sheet's
  // label files this account last, where the organizer reading
  // "zed@example.test" aloud expects it — not first under an empty name.
  const zedEmail = "zed@example.test";
  await t
    .withIdentity({
      ...namelessIdentity,
      subject: "zed",
      tokenIdentifier: "https://convex.test|zed",
      email: zedEmail,
    })
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
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
    [2, zedEmail],
  ]);
  // Only the ordering saw the email: the seat rows themselves still carry
  // the player-safe name, and the seatmate players see is name-only.
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
    null,
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

// A published convention with its seeded free pass, for the badge suites.
async function seedConvention(t: TestConvex<typeof schema>) {
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const conventionId: Id<"conventions"> = await organizer.mutation(
    api.conventions.lifecycle.createConvention,
    {
      organizationId,
      name: "Nameless Badge Gathering",
      startDate: Date.UTC(2027, 7, 6, 16, 0, 0),
      endDate: Date.UTC(2027, 7, 8, 23, 0, 0),
      playerCapacity: 100,
    },
  );
  await organizer.mutation(api.conventions.lifecycle.publishConvention, {
    conventionId,
  });
  const [ticketType] = await organizer.query(
    api.conventions.ticketTypes.listTicketTypesForOrganizer,
    { conventionId },
  );
  return { conventionId, ticketTypeId: ticketType!._id };
}

// Every label the organizer log stored for the registration, newest first,
// as "<type>:<label>" — across the single-player (player), multi-player
// (players), and result-line (result, previousResult) arms of the event
// union, so one assertion pins every path that labels a row.
async function auditLabelsFor(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  registrationId: Id<"tournamentRegistrations">,
) {
  const page = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.auditLog.listAuditEvents, {
      tournamentId,
      paginationOpts: { numItems: 100, cursor: null },
    });
  return page.page.flatMap(({ event }) => {
    const refs = [
      ...("player" in event ? [event.player] : []),
      ...("players" in event ? event.players : []),
      ...("result" in event ? event.result : []),
      ...("previousResult" in event ? (event.previousResult ?? []) : []),
    ];
    return refs
      .filter((ref) => ref.registrationId === registrationId)
      .map((ref) => `${event.type}:${ref.playerName}`);
  });
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
