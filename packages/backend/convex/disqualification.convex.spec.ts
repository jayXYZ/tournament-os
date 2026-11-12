/// <reference types="vite/client" />

// Disqualification (see CONTEXT.md "Disqualification (DQ)", IPG 1.1): the
// player is removed from the tournament and holds no place in its
// standings, where every lower-ranked player moves up one. Their row stays
// as a record at the tail, which is what keeps their finished matches
// feeding former opponents' tiebreakers. Their unresolved match in the open
// round is lost to the opponent; a result already on record is never
// flipped, and between rounds there is no match consequence. A bracket seat
// they held is walked over rather than refilled, and there is no way back.
import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { UserError } from "./model/errors";
import schema from "./schema";
import {
  matchForPlayer,
  opponentNumber,
  organizerIdentity,
  playOutCurrentRound,
  playerIdentity,
  rejection,
  seedTournamentWithPlayers,
} from "./specHelpers";
import {
  createConvexTest,
  expectStandingsMatchOracle,
} from "./specHelpers.runtime";

const BRACKET_ONLY = [
  {
    phaseOrder: 1,
    phaseType: "single_elimination" as const,
    phaseRoundMode: "dynamic" as const,
  },
];

test("a mid-round disqualification loses the player's unresolved match", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);

  await organizer.mutation(
    api.tournaments.registrations.disqualifyRegistration,
    {
      registrationId: registrationIds[0],
      reason: "  Cheating (IPG 4.8): marked sleeves  ",
    },
  );

  expect(await participationOf(t, registrationIds[0])).toBe("disqualified");
  const stored = await matchState(t, match._id);
  expect(stored.match?.matchStatus).toBe("completed");
  expect(stored.match?.currentResultKind).toBe("dq");
  expect(stored.revisions).toHaveLength(1);
  expect(stored.revisions[0]).toMatchObject({
    kind: "dq",
    actorRole: "organizer",
  });
  expect(
    stored.revisions[0].lines.find(
      (line) => line.registrationId === registrationIds[0],
    ),
  ).toMatchObject({
    outcome: "loss",
    matchPointsEarned: 0,
    gameWins: 0,
    gameLosses: 2,
  });
  expect(
    stored.revisions[0].lines.find(
      (line) => line.registrationId !== registrationIds[0],
    ),
  ).toMatchObject({
    outcome: "win",
    matchPointsEarned: 3,
    gameWins: 2,
    gameLosses: 0,
  });

  // One typed event for the disqualification, carrying its reason, then the
  // match consequence it caused. Not a drop, and not a concession.
  const journal = await auditEvents(t, tournamentId);
  const disqualified = journal.find(
    (row) => row.event.type === "player_disqualified",
  );
  const matchLoss = journal.find(
    (row) => row.event.type === "match_lost_to_disqualification",
  );
  if (
    disqualified?.event.type !== "player_disqualified" ||
    matchLoss?.event.type !== "match_lost_to_disqualification"
  ) {
    throw new Error("Expected the disqualification and its match loss");
  }
  expect(disqualified.actorRole).toBe("organizer");
  expect(disqualified.event.player.registrationId).toBe(registrationIds[0]);
  expect(disqualified.event.reason).toBe("Cheating (IPG 4.8): marked sleeves");
  expect(matchLoss.event.player.registrationId).toBe(registrationIds[0]);
  expect(matchLoss.event.roundNumber).toBe(1);
  expect(disqualified._creationTime).toBeLessThan(matchLoss._creationTime);
  expect(
    journal.filter(
      (row) =>
        row.event.type === "player_dropped" ||
        row.event.type === "match_conceded",
    ),
  ).toEqual([]);

  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.field).toMatchObject({ disqualified: 1, active: 3 });

  // The loss is automatic, like a drop's concession: the disqualification
  // behind it survives a rewind, so it does not hold one back.
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  expect(await participationOf(t, registrationIds[0])).toBe("disqualified");
});

test("a disqualification never flips a result already on record", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  const opponent = await opponentNumber(
    t,
    match._id,
    registrationIds[0],
    registrationIds,
  );
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: match._id,
    playerOneRegistrationId: registrationIds[0],
    playerTwoRegistrationId: registrationIds[opponent - 1],
    playerOneGameWins: 2,
    playerTwoGameWins: 0,
  });

  await organizer.mutation(
    api.tournaments.registrations.disqualifyRegistration,
    { registrationId: registrationIds[0] },
  );

  const stored = await matchState(t, match._id);
  expect(stored.revisions).toHaveLength(1);
  expect(stored.match?.currentResultKind).toBe("played");
  expect(
    stored.players.find((player) => player.playerId === registrationIds[0]),
  ).toMatchObject({ matchPointsEarned: 3, gameWins: 2 });
  const journal = await auditEvents(t, tournamentId);
  expect(
    journal.filter(
      (row) => row.event.type === "match_lost_to_disqualification",
    ),
  ).toEqual([]);
  const disqualified = journal.find(
    (row) => row.event.type === "player_disqualified",
  );
  if (disqualified?.event.type !== "player_disqualified") {
    throw new Error("Expected a player_disqualified event");
  }
  expect(disqualified.event.reason).toBeNull();
});

test("a disqualified player takes no place in the standings and everyone below moves up", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 8);
  const organizer = t.withIdentity(organizerIdentity);
  const { round: roundOne } = await playOutCurrentRound(t, tournamentId);
  const before = await storedStandings(t, roundOne._id);
  expect(before.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  // Second place: someone with players both above and below.
  const disqualifiedId = before[1].playerId;
  const revisionsBefore = await revisionCount(t, tournamentId);

  await organizer.mutation(
    api.tournaments.registrations.disqualifyRegistration,
    { registrationId: disqualifiedId },
  );

  // Between rounds there is no match to lose.
  expect(await revisionCount(t, tournamentId)).toBe(revisionsBefore);
  expect(
    (await auditEvents(t, tournamentId)).filter(
      (row) => row.event.type === "match_lost_to_disqualification",
    ),
  ).toEqual([]);

  // The other seven keep their order, one place up from third on, and the
  // disqualified player's row moves to the tail as a record with no place.
  const after = await storedStandings(t, roundOne._id);
  expect(after.map((row) => row.playerId)).toEqual([
    ...before
      .filter((row) => row.playerId !== disqualifiedId)
      .map((row) => row.playerId),
    disqualifiedId,
  ]);
  expect(after.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(after.map((row) => row.sortKey)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(after.map((row) => row.participationStatus ?? "active")).toEqual([
    ...Array.from({ length: 7 }, () => "active"),
    "disqualified",
  ]);
  expect(after[7]).toMatchObject({
    matchPoints: before[1].matchPoints,
    matchWins: before[1].matchWins,
  });
  const viewerNumber =
    registrationIds.findIndex((id) => id !== disqualifiedId) + 1;
  const playerStandings = await t
    .withIdentity(playerIdentity(viewerNumber))
    .query(api.tournaments.player.getLatestStandings, { tournamentId });
  expect(playerStandings?.rows.map((row) => row.rank)).toEqual([
    1, 2, 3, 4, 5, 6, 7,
  ]);
  // The organizer's standings leave them out as well.
  const organizerStandings = await organizer.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: roundOne._id },
  );
  expect(organizerStandings.map((row) => row.standing.playerId)).toEqual(
    after.slice(0, 7).map((row) => row.playerId),
  );

  // The next round pairs without them and gives them no place...
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  expect(
    (await currentPairings(t, tournamentId)).flatMap(({ players }) =>
      players.map((player) => player.playerId),
    ),
  ).not.toContain(disqualifiedId);
  const { round: roundTwo } = await playOutCurrentRound(t, tournamentId);
  const roundTwoRows = await storedStandings(t, roundTwo._id);
  expect(roundTwoRows.at(-1)).toMatchObject({
    playerId: disqualifiedId,
    participationStatus: "disqualified",
    rank: 8,
  });
  expect(await rankedPlayerIds(t, roundTwo._id)).toHaveLength(7);

  // ...while their finished match keeps feeding former opponents'
  // tiebreakers: every row, theirs included, matches a full recompute from
  // match history.
  await expectStandingsMatchOracle(t, tournamentId, roundTwo._id, 2, {
    assertRankOrder: false,
  });
  expect(
    roundTwoRows.find((row) => row.opponentIds?.includes(disqualifiedId)),
  ).toBeDefined();
});

test("a disqualification before a cut hands the place to the next player", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedStartedTournament(t, 8, [
    {
      phaseOrder: 1,
      phaseType: "swiss",
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff: { kind: "top_X_players", playerCount: 4 },
    },
    {
      phaseOrder: 2,
      phaseType: "single_elimination",
      phaseRoundMode: "dynamic",
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  const { round: swissRound } = await playOutCurrentRound(t, tournamentId);
  const swissOrder = await rankedPlayerIds(t, swissRound._id);

  // Second place is disqualified between the Swiss round and the cut.
  await organizer.mutation(
    api.tournaments.registrations.disqualifyRegistration,
    { registrationId: swissOrder[1] },
  );
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  // The top four are now first, third, fourth, and fifth: fifth takes the
  // freed place and sixth is cut.
  const bracketPlayers = (await currentPairings(t, tournamentId)).flatMap(
    ({ players }) => players.map((player) => player.playerId),
  );
  expect([...bracketPlayers].sort()).toEqual(
    [swissOrder[0], swissOrder[2], swissOrder[3], swissOrder[4]].sort(),
  );
  expect(await participationOf(t, swissOrder[5])).toBe("eliminated");
  expect(await participationOf(t, swissOrder[1])).toBe("disqualified");
});

test("earlier rounds and a rewind leave a disqualified player out too", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedStartedTournament(t, 8);
  const organizer = t.withIdentity(organizerIdentity);
  const { round: roundOne } = await playOutCurrentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const { round: roundTwo } = await playOutCurrentRound(t, tournamentId);
  // Two players, so the promoted round has more than one row to move.
  const roundTwoOrder = await rankedPlayerIds(t, roundTwo._id);
  const disqualifiedIds = [roundTwoOrder[2], roundTwoOrder[5]];
  const roundOneBefore = await storedStandings(t, roundOne._id);
  for (const registrationId of disqualifiedIds) {
    await organizer.mutation(
      api.tournaments.registrations.disqualifyRegistration,
      { registrationId },
    );
  }

  // Round one's stored snapshot is untouched: it is not the round anyone
  // ranks from. The organizer's view of it still leaves both players out
  // and closes the gaps.
  expect(await storedStandings(t, roundOne._id)).toEqual(roundOneBefore);
  const roundOneView = await organizer.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: roundOne._id },
  );
  expect(roundOneView.map((row) => row.standing.rank)).toEqual([
    1, 2, 3, 4, 5, 6,
  ]);
  expect(roundOneView.map((row) => row.standing.playerId)).toEqual(
    roundOneBefore
      .map((row) => row.playerId)
      .filter((id) => !disqualifiedIds.includes(id)),
  );

  // Rewinding round three reopens round two, which makes round one the
  // standings every player reads: its copy of the player goes too.
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const promoted = await storedStandings(t, roundOne._id);
  expect(promoted.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(promoted.map((row) => row.sortKey)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(promoted.map((row) => row.playerId)).toEqual([
    ...roundOneBefore
      .map((row) => row.playerId)
      .filter((id) => !disqualifiedIds.includes(id)),
    ...roundOneBefore
      .map((row) => row.playerId)
      .filter((id) => disqualifiedIds.includes(id)),
  ]);
  expect(promoted.slice(6).map((row) => row.participationStatus)).toEqual([
    "disqualified",
    "disqualified",
  ]);
  for (const registrationId of disqualifiedIds) {
    expect(await participationOf(t, registrationId)).toBe("disqualified");
  }

  // Completing the reopened round again still ranks six.
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: roundTwo._id,
  });
  expect(await rankedPlayerIds(t, roundTwo._id)).toHaveLength(6);
  expect(
    (await storedStandings(t, roundTwo._id))
      .slice(6)
      .map((row) => row.playerId)
      .sort(),
  ).toEqual([...disqualifiedIds].sort());
});

test("a rewind clears the elimination a disqualified player carried", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedStartedTournament(t, 4, BRACKET_ONLY);
  const organizer = t.withIdentity(organizerIdentity);
  const [semifinal] = await currentPairings(t, tournamentId);
  const { round: semifinalRound } = await playOutCurrentRound(t, tournamentId);
  // playOutCurrentRound awards each match to its first-listed player.
  const eliminatedId = semifinal.players[1].playerId;
  expect(await participationOf(t, eliminatedId)).toBe("eliminated");

  // An eliminated player can still be disqualified, and the elimination
  // stays on record beside it.
  await organizer.mutation(
    api.tournaments.registrations.disqualifyRegistration,
    { registrationId: eliminatedId },
  );
  const stamped = await t.run(async (ctx) => await ctx.db.get(eliminatedId));
  expect(stamped).toMatchObject({
    participationStatus: "disqualified",
    eliminatedByRoundId: semifinalRound._id,
  });

  // Rewinding the final reopens the semifinals: the elimination is undone,
  // the disqualification is not.
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const rewound = await t.run(async (ctx) => await ctx.db.get(eliminatedId));
  expect(rewound?.participationStatus).toBe("disqualified");
  expect(rewound?.eliminatedByRoundId).toBeUndefined();
  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.field).toMatchObject({ disqualified: 1, eliminated: 0 });
});

test("an unpublished pairing holding a disqualification's loss can still be broken", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournamentWithPlayers(t, {
    name: "Disqualification Event",
    playerCount: 4,
    autoPublishPairings: false,
  });
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  await organizer.mutation(
    api.tournaments.registrations.disqualifyRegistration,
    { registrationId: registrationIds[0] },
  );
  expect((await matchState(t, match._id)).match?.currentResultKind).toBe("dq");

  // The loss is automatic, so the break deletes it with the pairing and
  // frees the opponent; the disqualified player is not waiting to be paired.
  await organizer.mutation(api.tournaments.rounds.breakPairing, {
    matchId: match._id,
  });
  expect((await matchState(t, match._id)).match).toBeNull();
  const unpaired = await organizer.query(
    api.tournaments.rounds.listUnpairedPlayers,
    { roundId: match.tournamentRoundId },
  );
  expect(unpaired).toHaveLength(1);
  expect(unpaired[0].registrationId).not.toBe(registrationIds[0]);
});

test("a bracket seat a disqualified player held is walked over, never refilled", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedStartedTournament(t, 4, BRACKET_ONLY);
  const organizer = t.withIdentity(organizerIdentity);
  const [semifinalA, semifinalB] = await currentPairings(t, tournamentId);
  const [disqualifiedMidMatch, advancedByDq] = semifinalA.players.map(
    (player) => player.playerId,
  );
  const [winnerB, loserB] = semifinalB.players.map((player) => player.playerId);

  // Mid-match: the opponent is awarded the win and advances.
  await organizer.mutation(
    api.tournaments.registrations.disqualifyRegistration,
    { registrationId: disqualifiedMidMatch },
  );
  expect(
    (await matchState(t, semifinalA.match._id)).match?.currentResultKind,
  ).toBe("dq");
  await playOutCurrentRound(t, tournamentId);
  expect(await participationOf(t, disqualifiedMidMatch)).toBe("disqualified");

  // Between rounds: the other semifinal's winner is disqualified. Their
  // seat is walked over; the player they beat is not revived into it.
  await organizer.mutation(
    api.tournaments.registrations.disqualifyRegistration,
    { registrationId: winnerB },
  );
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const [final] = await currentPairings(t, tournamentId);
  expect(final.players).toHaveLength(1);
  expect(final.players[0]).toMatchObject({
    playerId: advancedByDq,
    isBye: true,
  });
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: final.match.tournamentRoundId,
  });
  await organizer.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });

  // The final standings place only the two players who were not
  // disqualified.
  expect(await rankedPlayerIds(t, final.match.tournamentRoundId)).toEqual([
    advancedByDq,
    loserB,
  ]);

  // The public profile keeps the tournament for a disqualified player:
  // their real record, and no placement.
  const page = await t.query(api.users.getPublicPlayerResults, {
    publicCode: await publicCodeOf(t, winnerB),
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(page.page).toHaveLength(1);
  expect(page.page[0]).toMatchObject({
    tournamentId,
    registrationStatus: "disqualified",
    finalRank: null,
    matchWins: 1,
    matchLosses: 0,
    matchPoints: 3,
  });
  const championPage = await t.query(api.users.getPublicPlayerResults, {
    publicCode: await publicCodeOf(t, advancedByDq),
    paginationOpts: { numItems: 10, cursor: null },
  });
  expect(championPage.page[0]).toMatchObject({ finalRank: 1 });
});

test("only an organizer can disqualify, only in play, and there is no way back", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournamentWithPlayers(t, {
    name: "Disqualification Event",
    playerCount: 4,
  });
  const organizer = t.withIdentity(organizerIdentity);
  const disqualify = (
    as: typeof organizer,
    registrationId: Id<"tournamentRegistrations">,
    reason?: string,
  ) =>
    as.mutation(api.tournaments.registrations.disqualifyRegistration, {
      registrationId,
      ...(reason === undefined ? {} : { reason }),
    });

  // Before play there is nothing to disqualify from, and the roster offers
  // no such action.
  const beforeStart = await rejection(
    disqualify(organizer, registrationIds[0]),
  );
  expect(beforeStart).toBeInstanceOf(UserError);
  expect((beforeStart as Error).message).toBe("Tournament is not in progress");
  expect(await disqualifyEffects(t, tournamentId)).toEqual([
    null,
    null,
    null,
    null,
  ]);

  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  expect(await disqualifyEffects(t, tournamentId)).toEqual([
    "disqualify",
    "disqualify",
    "disqualify",
    "disqualify",
  ]);

  // A player cannot disqualify anyone, and the refusal says nothing else.
  await expect(
    disqualify(t.withIdentity(playerIdentity(2)), registrationIds[0]),
  ).rejects.toThrow("Unauthorized");
  const tooLong = await rejection(
    disqualify(organizer, registrationIds[0], "x".repeat(1001)),
  );
  expect(tooLong).toBeInstanceOf(UserError);
  expect(await participationOf(t, registrationIds[0])).toBe("active");

  // A player who already dropped can still be disqualified (IPG 1.2).
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.dropSelf, { tournamentId });
  await disqualify(organizer, registrationIds[0]);
  expect(await participationOf(t, registrationIds[0])).toBe("disqualified");
  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.field).toMatchObject({ disqualified: 1, dropped: 0 });

  // No second disqualification, no drop, no reinstatement.
  for (const refused of [
    disqualify(organizer, registrationIds[0]),
    organizer.mutation(api.tournaments.registrations.dropRegistration, {
      registrationId: registrationIds[0],
    }),
    organizer.mutation(api.tournaments.registrations.reinstateRegistration, {
      registrationId: registrationIds[0],
    }),
    t
      .withIdentity(playerIdentity(1))
      .mutation(api.tournaments.player.dropSelf, { tournamentId }),
  ]) {
    expect(await rejection(refused)).toBeInstanceOf(UserError);
  }
  expect(await participationOf(t, registrationIds[0])).toBe("disqualified");
  expect((await disqualifyEffects(t, tournamentId))[0]).toBeNull();
  expect(
    (await auditEvents(t, tournamentId)).filter(
      (row) => row.event.type === "player_disqualified",
    ),
  ).toHaveLength(1);
});

async function seedStartedTournament(
  t: TestConvex<typeof schema>,
  playerCount: number,
  phases?: Parameters<typeof seedTournamentWithPlayers>[1]["phases"],
) {
  const seeded = await seedTournamentWithPlayers(t, {
    name: "Disqualification Event",
    playerCount,
    phases,
    tiebreak: "descending",
  });
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.startTournament, {
      tournamentId: seeded.tournamentId,
    });
  return seeded;
}

async function currentPairings(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const organizer = t.withIdentity(organizerIdentity);
  const round = await organizer.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  if (!round) {
    throw new Error("No current round in test setup");
  }
  return await organizer.query(api.tournaments.rounds.listRoundPairings, {
    roundId: round._id,
  });
}

// The players holding a place in a round's standings, in rank order: the
// stored rows without the disqualified tail.
async function rankedPlayerIds(
  t: TestConvex<typeof schema>,
  roundId: Id<"tournamentRounds">,
) {
  return (await storedStandings(t, roundId))
    .filter((row) => row.participationStatus !== "disqualified")
    .map((row) => row.playerId);
}

async function publicCodeOf(
  t: TestConvex<typeof schema>,
  registrationId: Id<"tournamentRegistrations">,
) {
  return await t.run(async (ctx) => {
    const registration = await ctx.db.get(registrationId);
    const participant = registration
      ? await ctx.db.get(registration.participantId)
      : null;
    const user = participant?.userId
      ? await ctx.db.get(participant.userId)
      : null;
    if (!user) {
      throw new Error("Player account not found in test setup");
    }
    return String(user.publicCode);
  });
}

// A round's standings rows exactly as stored, in rank order.
async function storedStandings(
  t: TestConvex<typeof schema>,
  roundId: Id<"tournamentRounds">,
) {
  return await t.run(
    async (ctx) =>
      await ctx.db
        .query("roundStandings")
        .withIndex("by_tournamentRoundId_and_rank", (q) =>
          q.eq("tournamentRoundId", roundId),
        )
        .collect(),
  );
}

async function revisionCount(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  return await t.run(async (ctx) => {
    const revisions = await ctx.db.query("matchResultRevisions").collect();
    return revisions.filter(
      (revision) => revision.tournamentId === tournamentId,
    ).length;
  });
}

async function matchState(
  t: TestConvex<typeof schema>,
  matchId: Id<"tournamentMatches">,
) {
  return await t.run(async (ctx) => ({
    match: await ctx.db.get(matchId),
    players: await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_tournamentMatchId_and_playerId", (q) =>
        q.eq("tournamentMatchId", matchId),
      )
      .take(2),
    revisions: await ctx.db
      .query("matchResultRevisions")
      .withIndex("by_tournamentMatchId", (q) =>
        q.eq("tournamentMatchId", matchId),
      )
      .collect(),
  }));
}

async function participationOf(
  t: TestConvex<typeof schema>,
  registrationId: Id<"tournamentRegistrations">,
) {
  return await t.run(
    async (ctx) => (await ctx.db.get(registrationId))?.participationStatus,
  );
}

// What the roster offers for each registration, in registration order.
async function disqualifyEffects(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const page = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.registrations.listRegistrationPage, {
      tournamentId,
      paginationOpts: { numItems: 25, cursor: null },
    });
  return [...page.page]
    .sort(
      (left, right) =>
        left.registration._creationTime - right.registration._creationTime,
    )
    .map((row) => row.disqualifyEffect);
}

async function auditEvents(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const page = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.auditLog.listAuditEvents, {
      tournamentId,
      paginationOpts: { numItems: 100, cursor: null },
    });
  return page.page;
}
