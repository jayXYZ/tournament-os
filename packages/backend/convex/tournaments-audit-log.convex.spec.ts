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

test("result reports, confirmations, and organizer overrides are audited", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const match = await matchForPlayer(t, tournamentId, registrationIds[0]);
  const opponent = await opponentNumber(
    t,
    match._id,
    registrationIds[0],
    registrationIds,
  );

  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: match._id,
      myGameWins: 2,
      opponentGameWins: 1,
    });
  await t
    .withIdentity(playerIdentity(opponent))
    .mutation(api.tournaments.player.confirmMatchResult, {
      matchId: match._id,
    });
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: match._id,
      playerOneRegistrationId: registrationIds[0],
      playerTwoRegistrationId: registrationIds[opponent - 1],
      playerOneGameWins: 0,
      playerTwoGameWins: 2,
    });

  // Newest first: override, confirmation, report, then the tournament start.
  const events = await auditEvents(t, tournamentId);
  expect(events.map((row) => row.event.type)).toEqual([
    "match_result_recorded",
    "match_result_confirmed",
    "match_result_reported",
    "tournament_started",
  ]);

  const reported = events[2];
  expect(reported.actorRole).toBe("player");
  expect(reported.actorName).toBe("Player 1");
  if (reported.event.type !== "match_result_reported") {
    throw new Error("Expected a reported-result event");
  }
  expect(reported.event.roundNumber).toBe(1);
  const myReportedLine = reported.event.result.find(
    (line) => line.registrationId === registrationIds[0],
  );
  expect(myReportedLine).toMatchObject({ gameWins: 2, gameLosses: 1 });

  const confirmed = events[1];
  expect(confirmed.actorRole).toBe("player");
  expect(confirmed.actorName).toBe(`Player ${opponent}`);

  // The override preserves the result it replaced — the dispute-resolution case.
  const recorded = events[0];
  expect(recorded.actorRole).toBe("organizer");
  expect(recorded.actorName).toBe("Organizer");
  if (recorded.event.type !== "match_result_recorded") {
    throw new Error("Expected a recorded-result event");
  }
  const myNewLine = recorded.event.result.find(
    (line) => line.registrationId === registrationIds[0],
  );
  expect(myNewLine).toMatchObject({ gameWins: 0, gameLosses: 2 });
  const myPreviousLine = recorded.event.previousResult?.find(
    (line) => line.registrationId === registrationIds[0],
  );
  expect(myPreviousLine).toMatchObject({ gameWins: 2, gameLosses: 1 });

  // Recording a result on a match without one logs no previous result.
  const otherNumber = await outsiderNumber(t, match._id, registrationIds);
  const otherMatch = await matchForPlayer(
    t,
    tournamentId,
    registrationIds[otherNumber - 1],
  );
  const otherOpponent = await opponentNumber(
    t,
    otherMatch._id,
    registrationIds[otherNumber - 1],
    registrationIds,
  );
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: otherMatch._id,
      playerOneRegistrationId: registrationIds[otherNumber - 1],
      playerTwoRegistrationId: registrationIds[otherOpponent - 1],
      playerOneGameWins: 2,
      playerTwoGameWins: 0,
    });
  const [freshRecord] = await auditEvents(t, tournamentId);
  if (freshRecord.event.type !== "match_result_recorded") {
    throw new Error("Expected a recorded-result event");
  }
  expect(freshRecord.event.previousResult).toBeNull();
});

test("registration changes and drops are audited with the acting side", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId, registrationIds } = await seedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });

  // A new player registers themselves, then cancels.
  const playerFive = t.withIdentity(playerIdentity(5));
  await playerFive.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId,
  });
  await playerFive.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });

  // The organizer drops and reinstates player 1.
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: registrationIds[0],
  });
  await organizer.mutation(api.tournaments.registrations.reinstateRegistration, {
    registrationId: registrationIds[0],
  });

  // Player 2 drops themselves mid-event.
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await t
    .withIdentity(playerIdentity(2))
    .mutation(api.tournaments.player.dropSelf, { tournamentId });

  const events = await auditEvents(t, tournamentId);
  expect(
    events.map((row) => [row.event.type, row.actorRole, row.actorName]),
  ).toEqual([
    ["player_dropped", "player", "Player 2"],
    ["tournament_started", "organizer", "Organizer"],
    ["player_reinstated", "organizer", "Organizer"],
    ["player_dropped", "organizer", "Organizer"],
    ["registration_cancelled", "player", "Player 5"],
    ["player_registered", "player", "Player 5"],
    ["tournament_published", "organizer", "Organizer"],
  ]);

  // Organizer-initiated drops name the affected player, not the actor.
  const organizerDrop = events[3];
  if (organizerDrop.event.type !== "player_dropped") {
    throw new Error("Expected a drop event");
  }
  expect(organizerDrop.event.player.registrationId).toBe(registrationIds[0]);
});

test("round and tournament lifecycle actions are audited", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedTournament(t, 4, [
    { phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 2 },
  ]);
  const organizer = t.withIdentity(organizerIdentity);

  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });

  const lifecycleEvents = (await auditEvents(t, tournamentId)).filter(
    (row) => row.event.type !== "match_result_recorded",
  );
  expect(lifecycleEvents.map((row) => row.event.type)).toEqual([
    "tournament_completed",
    "round_completed",
    "round_started",
    "round_completed",
    "tournament_started",
  ]);
  const roundStarted = lifecycleEvents[2];
  if (roundStarted.event.type !== "round_started") {
    throw new Error("Expected a round-started event");
  }
  expect(roundStarted.event.roundNumber).toBe(2);
  expect(roundStarted.event.playerCount).toBe(4);
});

test("cancelTournament is audited", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedTournament(t, 4);
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.cancelTournament, { tournamentId });

  const [latest] = await auditEvents(t, tournamentId);
  expect(latest.event.type).toBe("tournament_cancelled");
  expect(latest.actorRole).toBe("organizer");
});

test("listAuditEvents is organizer-only and paginates newest first", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);

  await expect(
    t.withIdentity(playerIdentity(1)).query(
      api.tournaments.auditLog.listAuditEvents,
      { tournamentId, paginationOpts: { numItems: 10, cursor: null } },
    ),
  ).rejects.toThrow("Unauthorized");

  await playOutCurrentRound(t, tournamentId);
  const organizer = t.withIdentity(organizerIdentity);
  const firstPage = await organizer.query(
    api.tournaments.auditLog.listAuditEvents,
    { tournamentId, paginationOpts: { numItems: 2, cursor: null } },
  );
  expect(firstPage.page).toHaveLength(2);
  expect(firstPage.page[0].event.type).toBe("round_completed");
  expect(firstPage.isDone).toBe(false);

  const secondPage = await organizer.query(
    api.tournaments.auditLog.listAuditEvents,
    {
      tournamentId,
      paginationOpts: { numItems: 100, cursor: firstPage.continueCursor },
    },
  );
  // The remaining events end with the oldest: the tournament start.
  expect(
    secondPage.page[secondPage.page.length - 1].event.type,
  ).toBe("tournament_started");
});

test("deleting a tournament removes its audit trail", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedStartedTournament(t, 4);
  expect((await auditEvents(t, tournamentId)).length).toBeGreaterThan(0);

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.deleteTournament, { tournamentId });

  const remaining = await t.run(async (ctx) => {
    return await ctx.db
      .query("tournamentAuditEvents")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
      .take(10);
  });
  expect(remaining).toHaveLength(0);
});

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

async function seedTournament(
  t: TestConvex<typeof schema>,
  playerCount: number,
  phases: {
    phaseOrder: number;
    phaseRoundMode: "fixed" | "dynamic";
    phaseTotalRounds?: number;
  }[] = [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3 }],
) {
  const { organizationId } = await seedOrganizer(t);
  const tournamentId: Id<"tournaments"> = await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
      organizationId,
      name: "Audit Log Event",
      startDate: Date.now(),
      playerCapacity: 16,
      format: "standard",
      phases,
    });

  const registrationIds = await t.run(async (ctx) => {
    const now = Date.now();
    const ids: Id<"tournamentRegistrations">[] = [];
    for (let playerNumber = 1; playerNumber <= playerCount; playerNumber += 1) {
      const identity = playerIdentity(playerNumber);
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        publicCode: playerNumber,
        email: identity.email,
        name: identity.name,
        updatedAt: now,
      });
      ids.push(
        await ctx.db.insert("tournamentRegistrations", {
          tournamentId,
          userId,
          status: "active",
          playerName: identity.name,
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

// Records an organizer result for every two-player match in the current round
// and completes it, so tests can advance rounds without player reports.
async function playOutCurrentRound(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const organizer = t.withIdentity(organizerIdentity);
  const round = await organizer.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  if (!round) {
    throw new Error("No current round to play out");
  }
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round._id },
  );
  for (const { match, players } of pairings) {
    if (players.length !== 2) {
      continue;
    }
    await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: match._id,
      playerOneRegistrationId: players[0].playerId,
      playerTwoRegistrationId: players[1].playerId,
      playerOneGameWins: 2,
      playerTwoGameWins: 0,
    });
  }
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: round._id,
  });
}

async function matchForPlayer(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  registrationId: Id<"tournamentRegistrations">,
) {
  return await t.run(async (ctx) => {
    const playerRows = await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_playerId", (q) => q.eq("playerId", registrationId))
      .take(16);
    for (const playerRow of playerRows) {
      const match = await ctx.db.get(playerRow.tournamentMatchId);
      if (match && match.tournamentId === tournamentId) {
        return match;
      }
    }
    throw new Error("Match not found in test setup");
  });
}

// Resolves the opponent's 1-based player number in a two-player match, so
// tests don't depend on which pairing the seeded shuffle produced.
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

// A registered player who is not in the given match, for cross-table checks.
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
      publicCode: 1,
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
