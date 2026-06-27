/// <reference types="vite/client" />

import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const organizerIdentity = {
  issuer: "https://convex.test",
  subject: "organizer",
  tokenIdentifier: "https://convex.test|organizer",
  email: "organizer@example.test",
  name: "Organizer",
};

function playerIdentity(playerNumber: number) {
  return {
    issuer: "https://convex.test",
    subject: `player-${playerNumber}`,
    tokenIdentifier: `https://convex.test|player-${playerNumber}`,
    email: `player${playerNumber}@example.test`,
    name: `Player ${playerNumber}`,
  };
}

test("reportMyMatchResult records the result for both players", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);

  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: match._id,
      myGameWins: 2,
      opponentGameWins: 1,
    });

  const stored = await t.run(async (ctx) => {
    const storedMatch = await ctx.db.get(match._id);
    const players = await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_tournamentMatchId_and_playerId", (q) =>
        q.eq("tournamentMatchId", match._id),
      )
      .take(2);
    return { storedMatch, players };
  });

  expect(stored.storedMatch?.matchStatus).toBe("completed");
  expect(stored.storedMatch?.reportedByRegistrationId).toBe(registrationIds[0]);
  const myRow = stored.players.find(
    (player) => player.playerId === registrationIds[0],
  );
  const opponentRow = stored.players.find(
    (player) => player.playerId !== registrationIds[0],
  );
  expect(myRow?.matchPointsEarned).toBe(3);
  expect(myRow?.gameWins).toBe(2);
  expect(myRow?.gameLosses).toBe(1);
  expect(opponentRow?.matchPointsEarned).toBe(0);
  expect(opponentRow?.gameWins).toBe(1);
  expect(opponentRow?.gameLosses).toBe(2);
});

test("reportMyMatchResult rejects outsiders, byes, re-reports, and bad scores", async () => {
  const t = convexTest(schema, modules);
  // Five players: the lowest-seeded player gets the round-one bye.
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 5);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  // The lowest seed (player 5) takes the round-one bye regardless of shuffle.
  const byeMatch = await matchForPlayer(t, tournamentId, 1, registrationIds[4]);
  const opponent = await opponentNumber(
    t,
    match._id,
    registrationIds[0],
    registrationIds,
  );
  const outsider = await outsiderNumber(t, match._id, registrationIds);

  // A player registered but seated at another table cannot report this match.
  await expect(
    t.withIdentity(playerIdentity(outsider)).mutation(
      api.tournaments.player.reportMyMatchResult,
      { matchId: match._id, myGameWins: 2, opponentGameWins: 0 },
    ),
  ).rejects.toThrow("You are not part of this match");

  await expect(
    t.withIdentity(playerIdentity(99)).mutation(
      api.tournaments.player.reportMyMatchResult,
      { matchId: match._id, myGameWins: 2, opponentGameWins: 0 },
    ),
  ).rejects.toThrow("Not registered for this tournament");

  await expect(
    t.withIdentity(playerIdentity(5)).mutation(
      api.tournaments.player.reportMyMatchResult,
      { matchId: byeMatch._id, myGameWins: 2, opponentGameWins: 0 },
    ),
  ).rejects.toThrow("Only two-player matches can be reported by players");

  await expect(
    t.withIdentity(playerIdentity(1)).mutation(
      api.tournaments.player.reportMyMatchResult,
      { matchId: match._id, myGameWins: 3, opponentGameWins: 0 },
    ),
  ).rejects.toThrow("Game wins must be a whole number between 0 and 2");

  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: match._id,
      myGameWins: 2,
      opponentGameWins: 0,
    });
  await expect(
    t.withIdentity(playerIdentity(opponent)).mutation(
      api.tournaments.player.reportMyMatchResult,
      { matchId: match._id, myGameWins: 2, opponentGameWins: 0 },
    ),
  ).rejects.toThrow("Match already has a result");
});

test("confirmMatchResult requires the opponent; organizer override clears the report", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  const opponent = await opponentNumber(
    t,
    match._id,
    registrationIds[0],
    registrationIds,
  );

  await expect(
    t.withIdentity(playerIdentity(opponent)).mutation(
      api.tournaments.player.confirmMatchResult,
      { matchId: match._id },
    ),
  ).rejects.toThrow("Match has no player-reported result to confirm");

  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: match._id,
      myGameWins: 2,
      opponentGameWins: 1,
    });

  await expect(
    t.withIdentity(playerIdentity(1)).mutation(
      api.tournaments.player.confirmMatchResult,
      { matchId: match._id },
    ),
  ).rejects.toThrow("The reporting player cannot confirm their own result");

  await t
    .withIdentity(playerIdentity(opponent))
    .mutation(api.tournaments.player.confirmMatchResult, {
      matchId: match._id,
    });
  let stored = await t.run(async (ctx) => await ctx.db.get(match._id));
  expect(stored?.matchStatus).toBe("confirmed");
  expect(stored?.reportedByRegistrationId).toBe(registrationIds[0]);

  // The organizer can still override a player-reported result; doing so
  // makes the result organizer-final.
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: match._id,
      playerOneRegistrationId: registrationIds[0],
      playerTwoRegistrationId: registrationIds[opponent - 1],
      playerOneGameWins: 0,
      playerTwoGameWins: 2,
    });
  stored = await t.run(async (ctx) => await ctx.db.get(match._id));
  expect(stored?.matchStatus).toBe("completed");
  expect(stored?.reportedByRegistrationId).toBeUndefined();
});

test("player-reported results complete rounds and feed standings", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const round = await currentRound(t, tournamentId);
  const matchOne = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  const opponentOne = await opponentNumber(
    t,
    matchOne._id,
    registrationIds[0],
    registrationIds,
  );
  // The other table is whichever match player 1 is not in.
  const otherNumber = await outsiderNumber(t, matchOne._id, registrationIds);
  const matchTwo = await matchForPlayer(
    t,
    tournamentId,
    1,
    registrationIds[otherNumber - 1],
  );

  // Player 1 wins and the opponent confirms.
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: matchOne._id,
      myGameWins: 2,
      opponentGameWins: 0,
    });
  await t
    .withIdentity(playerIdentity(opponentOne))
    .mutation(api.tournaments.player.confirmMatchResult, {
      matchId: matchOne._id,
    });
  // The other table reports but leaves it unconfirmed.
  await t
    .withIdentity(playerIdentity(otherNumber))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: matchTwo._id,
      myGameWins: 2,
      opponentGameWins: 1,
    });

  // One confirmed and one unconfirmed report both count as results.
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.completeRound, { roundId: round._id });

  const standings = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getLatestStandings, { tournamentId });
  expect(standings?.roundNumber).toBe(1);
  expect(standings?.rows).toHaveLength(4);
  expect(standings?.rows[0].matchPoints).toBe(3);
  const myRow = standings?.rows.find((row) => row.isMe);
  expect(myRow?.name).toBe("Player 1");
  expect(myRow?.matchPoints).toBe(3);
  expect(myRow?.matchWins).toBe(1);
});

test("getMyCurrentMatch walks the tournament lifecycle", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId, registrationIds } = await seedTournament(t, 4);
  const playerOne = t.withIdentity(playerIdentity(1));

  let current = await playerOne.query(api.tournaments.player.getMyCurrentMatch, {
    tournamentId,
  });
  expect(current.kind).toBe("not_started");

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.startTournament, { tournamentId });
  current = await playerOne.query(api.tournaments.player.getMyCurrentMatch, {
    tournamentId,
  });
  expect(current.kind).toBe("match");
  if (current.kind !== "match") {
    throw new Error("Expected an active match");
  }
  const opponentOne = await opponentNumber(
    t,
    current.match._id,
    registrationIds[0],
    registrationIds,
  );
  expect(current.round.roundNumber).toBe(1);
  expect(current.match.matchStatus).toBe("upcoming");
  expect(current.me.registrationId).toBe(registrationIds[0]);
  expect(current.opponent?.name).toBe(`Player ${opponentOne}`);
  expect(current.match.tableNumber).toBeGreaterThanOrEqual(1);

  await playerOne.mutation(api.tournaments.player.reportMyMatchResult, {
    matchId: current.match._id,
    myGameWins: 2,
    opponentGameWins: 1,
  });
  current = await playerOne.query(api.tournaments.player.getMyCurrentMatch, {
    tournamentId,
  });
  if (current.kind !== "match") {
    throw new Error("Expected an active match");
  }
  expect(current.match.matchStatus).toBe("completed");
  expect(current.match.reportedByRegistrationId).toBe(registrationIds[0]);

  const round = await currentRound(t, tournamentId);
  const otherNumber = await outsiderNumber(t, current.match._id, registrationIds);
  const otherMatch = await matchForPlayer(
    t,
    tournamentId,
    1,
    registrationIds[otherNumber - 1],
  );
  await t
    .withIdentity(playerIdentity(otherNumber))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: otherMatch._id,
      myGameWins: 2,
      opponentGameWins: 0,
    });
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.completeRound, { roundId: round._id });

  current = await playerOne.query(api.tournaments.player.getMyCurrentMatch, {
    tournamentId,
  });
  expect(current.kind).toBe("between_rounds");
});

test("getMyMatchHistory reports per-round outcomes", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  const opponent = await opponentNumber(
    t,
    match._id,
    registrationIds[0],
    registrationIds,
  );

  let history = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getMyMatchHistory, { tournamentId });
  expect(history).toHaveLength(1);
  expect(history[0].result).toBe("pending");

  await t
    .withIdentity(playerIdentity(opponent))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: match._id,
      myGameWins: 2,
      opponentGameWins: 0,
    });
  history = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getMyMatchHistory, { tournamentId });
  expect(history[0].result).toBe("loss");
  expect(history[0].roundNumber).toBe(1);
  expect(history[0].opponentName).toBe(`Player ${opponent}`);
  expect(history[0].myGameWins).toBe(0);
  expect(history[0].myGameLosses).toBe(2);
});

test("dropSelf removes the player from future rounds but keeps read access", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId, registrationIds } = await seedTournament(t, 4);
  const playerFour = t.withIdentity(playerIdentity(4));

  await expect(
    playerFour.mutation(api.tournaments.player.dropSelf, { tournamentId }),
  ).rejects.toThrow("Tournament is not in progress");

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.startTournament, { tournamentId });
  const round = await currentRound(t, tournamentId);
  const playerFourMatch = await matchForPlayer(
    t,
    tournamentId,
    1,
    registrationIds[3],
  );
  const playerFourOpponent = await opponentNumber(
    t,
    playerFourMatch._id,
    registrationIds[3],
    registrationIds,
  );

  // Player 4 loses their match (the opponent reports the win), then drops.
  await t
    .withIdentity(playerIdentity(playerFourOpponent))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: playerFourMatch._id,
      myGameWins: 2,
      opponentGameWins: 0,
    });
  await playerFour.mutation(api.tournaments.player.dropSelf, { tournamentId });
  await expect(
    playerFour.mutation(api.tournaments.player.dropSelf, { tournamentId }),
  ).rejects.toThrow("Active registration not found");

  // Report the other table so the round can complete.
  const otherNumber = await outsiderNumber(
    t,
    playerFourMatch._id,
    registrationIds,
  );
  const otherMatch = await matchForPlayer(
    t,
    tournamentId,
    1,
    registrationIds[otherNumber - 1],
  );
  await t
    .withIdentity(playerIdentity(otherNumber))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: otherMatch._id,
      myGameWins: 2,
      opponentGameWins: 1,
    });
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: round._id,
  });
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  const roundTwoPlayerIds = await t.run(async (ctx) => {
    const phase = await ctx.db
      .query("tournamentPhases")
      .withIndex("by_tournamentId_and_phaseOrder", (q) =>
        q.eq("tournamentId", tournamentId).eq("phaseOrder", 1),
      )
      .unique();
    const roundTwo = await ctx.db
      .query("tournamentRounds")
      .withIndex("by_tournamentPhaseId_and_roundNumber", (q) =>
        q.eq("tournamentPhaseId", phase!._id).eq("roundNumber", 2),
      )
      .unique();
    const matches = await ctx.db
      .query("tournamentMatches")
      .withIndex("by_tournamentRoundId", (q) =>
        q.eq("tournamentRoundId", roundTwo!._id),
      )
      .take(16);
    const playerIds: Id<"tournamentRegistrations">[] = [];
    for (const roundMatch of matches) {
      const players = await ctx.db
        .query("tournamentMatchPlayers")
        .withIndex("by_tournamentMatchId_and_playerId", (q) =>
          q.eq("tournamentMatchId", roundMatch._id),
        )
        .take(2);
      playerIds.push(...players.map((player) => player.playerId));
    }
    return playerIds;
  });
  expect(roundTwoPlayerIds).not.toContain(registrationIds[3]);
  expect(roundTwoPlayerIds).toHaveLength(3);

  // Dropped players keep read access; their loss still feeds standings.
  const current = await playerFour.query(
    api.tournaments.player.getMyCurrentMatch,
    { tournamentId },
  );
  expect(current.myRegistrationStatus).toBe("dropped");
  const standings = await playerFour.query(
    api.tournaments.player.getLatestStandings,
    { tournamentId },
  );
  expect(standings?.rows).toHaveLength(3);
  expect(standings?.rows.some((row) => row.isMe)).toBe(false);
});

test("player queries reject users who never registered", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  const outsider = t.withIdentity(playerIdentity(99));

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      tokenIdentifier: playerIdentity(99).tokenIdentifier,
      email: playerIdentity(99).email,
      name: playerIdentity(99).name,
      updatedAt: Date.now(),
    });
  });

  await expect(
    outsider.query(api.tournaments.player.getMyCurrentMatch, { tournamentId }),
  ).rejects.toThrow("Not registered for this tournament");
  await expect(
    outsider.query(api.tournaments.player.getLatestStandings, { tournamentId }),
  ).rejects.toThrow("Not registered for this tournament");
});

async function seedTournament(t: TestConvex<typeof schema>, playerCount: number) {
  const { organizationId } = await seedOrganizer(t);
  const tournamentId: Id<"tournaments"> = await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
      organizationId,
      name: "Player Controller Event",
      startDate: Date.now(),
      playerCapacity: 16,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3 }],
    });

  const registrationIds = await t.run(async (ctx) => {
    const now = Date.now();
    const ids: Id<"tournamentRegistrations">[] = [];
    for (let playerNumber = 1; playerNumber <= playerCount; playerNumber += 1) {
      const identity = playerIdentity(playerNumber);
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        email: identity.email,
        name: identity.name,
        updatedAt: now,
      });
      ids.push(
        await ctx.db.insert("tournamentRegistrations", {
          tournamentId,
          userId,
          status: "active",
          createdAt: now + playerNumber,
          updatedAt: now,
        }),
      );
    }
    return ids;
  });

  return { tournamentId, registrationIds };
}

async function seedStartedTournament(
  t: TestConvex<typeof schema>,
  playerCount: number,
) {
  const seeded = await seedTournament(t, playerCount);
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.startTournament, {
      tournamentId: seeded.tournamentId,
    });
  return seeded;
}

async function currentRound(
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
    const round = await ctx.db.get(phase!.phaseCurrentRound!);
    if (!round) {
      throw new Error("Current round missing in test setup");
    }
    return round;
  });
}

async function matchForPlayer(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  roundNumber: number,
  registrationId: Id<"tournamentRegistrations">,
) {
  return await t.run(async (ctx) => {
    const playerRows = await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_playerId", (q) => q.eq("playerId", registrationId))
      .take(16);
    for (const playerRow of playerRows) {
      const match = await ctx.db.get(playerRow.tournamentMatchId);
      if (!match || match.tournamentId !== tournamentId) {
        continue;
      }
      const round = await ctx.db.get(match.tournamentRoundId);
      if (round?.roundNumber === roundNumber) {
        return match;
      }
    }
    throw new Error("Match not found in test setup");
  });
}

// Resolves the opponent's 1-based player number in a two-player match, so
// player-flow tests don't depend on which pairing the seeded shuffle produced.
async function opponentNumber(
  t: TestConvex<typeof schema>,
  matchId: Id<"tournamentMatches">,
  myRegistrationId: Id<"tournamentRegistrations">,
  registrationIds: Id<"tournamentRegistrations">[],
) {
  const opponentId = await t.run(async (ctx) => {
    const players = await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_tournamentMatchId_and_playerId", (q) =>
        q.eq("tournamentMatchId", matchId),
      )
      .take(2);
    return (
      players.find((player) => player.playerId !== myRegistrationId)
        ?.playerId ?? null
    );
  });
  const index = opponentId ? registrationIds.indexOf(opponentId) : -1;
  if (index < 0) {
    throw new Error("Opponent not found for match");
  }
  return index + 1;
}

// A registered player who is not in the given match (e.g. someone playing at
// another table), for outsider-rejection checks.
async function outsiderNumber(
  t: TestConvex<typeof schema>,
  matchId: Id<"tournamentMatches">,
  registrationIds: Id<"tournamentRegistrations">[],
) {
  const participantIds = await t.run(async (ctx) => {
    const players = await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_tournamentMatchId_and_playerId", (q) =>
        q.eq("tournamentMatchId", matchId),
      )
      .take(2);
    return players.map((player) => player.playerId);
  });
  const index = registrationIds.findIndex((id) => !participantIds.includes(id));
  if (index < 0) {
    throw new Error("No outsider available for match");
  }
  return index + 1;
}

async function seedOrganizer(t: TestConvex<typeof schema>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: organizerIdentity.tokenIdentifier,
      email: organizerIdentity.email,
      name: organizerIdentity.name,
      updatedAt: now,
    });
    const organizationId = await ctx.db.insert("organizations", {
      name: "Test Org",
      slug: "test-org",
      createdBy: userId,
      status: "active",
      updatedAt: now,
    });
    await ctx.db.insert("organizationMemberships", {
      organizationId,
      userId,
      email: organizerIdentity.email,
      role: "owner",
      status: "active",
      updatedAt: now,
    });

    return { organizationId, userId };
  });
}
