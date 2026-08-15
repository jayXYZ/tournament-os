/// <reference types="vite/client" />

// A drop during the player's own unfinished match concedes it immediately:
// the opponent wins the structure's required game wins to zero as an Awarded
// Result, recorded as a "concession" revision attributed to whoever recorded
// the drop. Finished matches, byes, and between-round drops are untouched,
// and the automatic concession never blocks a rewind. See CONTEXT.md "Drop",
// "Concession", and "Rewind".
import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  insertLinkedParticipant,
  organizerIdentity,
  seedOrganizer,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

test("a mid-round self-drop concedes the unfinished match to the opponent", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  const opponent = await opponentNumber(
    t,
    match._id,
    registrationIds[0],
    registrationIds,
  );

  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.dropSelf, { tournamentId });

  const stored = await matchState(t, match._id);
  expect(stored.match?.matchStatus).toBe("completed");
  expect(stored.match?.currentResultKind).toBe("concession");
  // System-awarded, not a self-report awaiting anything.
  expect(stored.match?.reportedByRegistrationId).toBeUndefined();
  expect(stored.revisions).toHaveLength(1);
  expect(stored.match?.currentResultRevisionId).toBe(stored.revisions[0]._id);
  expect(stored.revisions[0].kind).toBe("concession");
  expect(stored.revisions[0].actorRole).toBe("player");

  // Required game wins to zero (best of 3 → 2–0), both on the revision lines
  // and the denormalized rows standings read.
  const concederLine = stored.revisions[0].lines.find(
    (line) => line.registrationId === registrationIds[0],
  );
  const winnerLine = stored.revisions[0].lines.find(
    (line) => line.registrationId !== registrationIds[0],
  );
  expect(concederLine).toMatchObject({
    outcome: "loss",
    matchPointsEarned: 0,
    gameWins: 0,
    gameLosses: 2,
    gameDraws: 0,
  });
  expect(winnerLine).toMatchObject({
    outcome: "win",
    matchPointsEarned: 3,
    gameWins: 2,
    gameLosses: 0,
    gameDraws: 0,
  });
  const concederRow = stored.players.find(
    (player) => player.playerId === registrationIds[0],
  );
  const winnerRow = stored.players.find(
    (player) => player.playerId !== registrationIds[0],
  );
  expect(concederRow).toMatchObject({
    matchPointsEarned: 0,
    gameWins: 0,
    gameLosses: 2,
    gameDraws: 0,
  });
  expect(winnerRow).toMatchObject({
    matchPointsEarned: 3,
    gameWins: 2,
    gameLosses: 0,
    gameDraws: 0,
  });

  const conceded = await auditEventsOfType(t, tournamentId, "match_conceded");
  expect(conceded).toHaveLength(1);
  expect(conceded[0].actorRole).toBe("player");
  if (conceded[0].event.type !== "match_conceded") {
    throw new Error("Expected a match_conceded event");
  }
  expect(conceded[0].event.player.registrationId).toBe(registrationIds[0]);
  expect(conceded[0].event.matchId).toBe(match._id);

  // Both players' match cards see concession provenance, not an organizer
  // entry: the query exposes the result kind alongside the (cleared)
  // reporter.
  for (const viewer of [1, opponent]) {
    const view = await t
      .withIdentity(playerIdentity(viewer))
      .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
    if (view.kind !== "match") {
      throw new Error("Expected the concluded match to still be visible");
    }
    expect(view.match.currentResultKind).toBe("concession");
    expect(view.match.reportedByRegistrationId).toBeNull();
  }

  // The awarded result stands against player re-reports...
  await expect(
    t
      .withIdentity(playerIdentity(opponent))
      .mutation(api.tournaments.player.reportMyMatchResult, {
        matchId: match._id,
        myGameWins: 2,
        opponentGameWins: 1,
      }),
  ).rejects.toThrow("Match already has a result");

  // ...but an organizer override still fixes a match that actually finished
  // before the drop, preserving the concession it replaced.
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: match._id,
      playerOneRegistrationId: registrationIds[0],
      playerTwoRegistrationId: registrationIds[opponent - 1],
      playerOneGameWins: 2,
      playerTwoGameWins: 1,
    });
  const overridden = await matchState(t, match._id);
  expect(overridden.revisions).toHaveLength(2);
  expect(overridden.match?.currentResultKind).toBe("played");
  const recorded = await auditEventsOfType(
    t,
    tournamentId,
    "match_result_recorded",
  );
  if (recorded[0].event.type !== "match_result_recorded") {
    throw new Error("Expected a match_result_recorded event");
  }
  expect(recorded[0].event.previousResult).not.toBeNull();
});

test("an organizer mid-round drop concedes with the organizer as actor", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[1]);

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.registrations.dropRegistration, {
      registrationId: registrationIds[1],
    });

  const stored = await matchState(t, match._id);
  expect(stored.match?.currentResultKind).toBe("concession");
  expect(stored.revisions).toHaveLength(1);
  expect(stored.revisions[0].actorRole).toBe("organizer");
  const conceded = await auditEventsOfType(t, tournamentId, "match_conceded");
  expect(conceded).toHaveLength(1);
  expect(conceded[0].actorRole).toBe("organizer");
  expect(conceded[0].actorName).toBe("Organizer");
  if (conceded[0].event.type !== "match_conceded") {
    throw new Error("Expected a match_conceded event");
  }
  expect(conceded[0].event.player.registrationId).toBe(registrationIds[1]);
});

test("a drop leaves a finished match's result alone", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);

  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: match._id,
      myGameWins: 2,
      opponentGameWins: 1,
    });
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.dropSelf, { tournamentId });

  const stored = await matchState(t, match._id);
  expect(stored.revisions).toHaveLength(1);
  expect(stored.revisions[0].kind).toBe("played");
  expect(stored.match?.currentResultKind).toBe("played");
  expect(await auditEventsOfType(t, tournamentId, "match_conceded")).toEqual(
    [],
  );
});

test("bye-round and between-round drops concede nothing", async () => {
  const t = createConvexTest();
  // Five players: the lowest seed (player 5) takes the round-one bye.
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 5);

  // The bye is already an awarded result; dropping its holder changes nothing.
  const byeMatch = await matchForPlayer(t, tournamentId, 1, registrationIds[4]);
  await t
    .withIdentity(playerIdentity(5))
    .mutation(api.tournaments.player.dropSelf, { tournamentId });
  const byeState = await matchState(t, byeMatch._id);
  expect(byeState.revisions).toHaveLength(1);
  expect(byeState.revisions[0].kind).toBe("bye");
  expect(byeState.match?.currentResultKind).toBe("bye");

  // Report both real matches and complete the round; a drop between rounds
  // has no open match to concede.
  const reported = new Set<string>();
  for (const number of [1, 2, 3, 4]) {
    const registrationId = registrationIds[number - 1];
    const match = await matchForPlayer(t, tournamentId, 1, registrationId);
    if (reported.has(match._id)) {
      continue;
    }
    reported.add(match._id);
    await t
      .withIdentity(playerIdentity(number))
      .mutation(api.tournaments.player.reportMyMatchResult, {
        matchId: match._id,
        myGameWins: 2,
        opponentGameWins: 0,
      });
  }
  const round = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.rounds.getCurrentRound, { tournamentId });
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.completeRound, { roundId: round!._id });
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.dropSelf, { tournamentId });

  expect(await auditEventsOfType(t, tournamentId, "match_conceded")).toEqual(
    [],
  );
});

test("a drop concession does not block rewinding the round", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);

  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.dropSelf, { tournamentId });
  expect((await matchState(t, match._id)).revisions).toHaveLength(1);

  // The concession is automatic — the drop behind it survives the rewind, so
  // the round still counts as untouched.
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.rewindLatestRound, { tournamentId });

  const after = await t.run(async (ctx) => ({
    tournament: await ctx.db.get(tournamentId),
    match: await ctx.db.get(match._id),
    revisions: await ctx.db
      .query("matchResultRevisions")
      .withIndex("by_tournamentMatchId", (q) =>
        q.eq("tournamentMatchId", match._id),
      )
      .collect(),
    registration: await ctx.db.get(registrationIds[0]),
  }));
  // Round one rewinds back to registration; the un-paired match and its
  // concession revision are gone, but the drop itself stands.
  expect(after.tournament?.lifecycle).toBe("registration");
  expect(after.match).toBeNull();
  expect(after.revisions).toEqual([]);
  expect(after.registration?.participationStatus).toBe("dropped");
});

test("best-of-1 concessions award one game and a second drop concedes nothing", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4, [
    { phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3, bestOf: 1 },
  ]);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  const opponent = await opponentNumber(
    t,
    match._id,
    registrationIds[0],
    registrationIds,
  );

  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.dropSelf, { tournamentId });
  // The opponent's own later drop finds the match already resolved.
  await t
    .withIdentity(playerIdentity(opponent))
    .mutation(api.tournaments.player.dropSelf, { tournamentId });

  const stored = await matchState(t, match._id);
  expect(stored.revisions).toHaveLength(1);
  const winnerLine = stored.revisions[0].lines.find(
    (line) => line.registrationId !== registrationIds[0],
  );
  expect(winnerLine).toMatchObject({ outcome: "win", gameWins: 1 });
  expect(
    await auditEventsOfType(t, tournamentId, "match_conceded"),
  ).toHaveLength(1);
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

async function seedStartedTournament(
  t: TestConvex<typeof schema>,
  playerCount: number,
  phases: {
    phaseOrder: number;
    phaseRoundMode: "fixed" | "dynamic";
    phaseTotalRounds?: number;
    bestOf?: 1 | 3 | 5;
  }[] = [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3 }],
) {
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Drop Concession Event",
      startDate: Date.now(),
      playerCapacity: 16,
      format: "standard",
      phases,
    },
  );
  await organizer.mutation(
    api.tournaments.lifecycle.updatePairingsAutoPublish,
    {
      tournamentId,
      autoPublishPairings: true,
    },
  );

  const registrationIds = await t.run(async (ctx) => {
    const now = Date.now();
    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found in test setup");
    }
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
      const participant0Id = await insertLinkedParticipant(ctx, userId);
      ids.push(
        await ctx.db.insert("tournamentRegistrations", {
          tournamentId,
          participantId: participant0Id,
          tournamentStartDate: tournament.startDate,
          entryStatus: "confirmed",
          participationStatus: "active",
          createdAt: now + playerNumber,
          // Descending so equal records rank in player-number order, keeping
          // the round-one bye on the highest player number.
          tiebreakRandom: 100_000 - playerNumber,
          updatedAt: now,
        }),
      );
    }
    await ctx.db.patch(tournamentId, {
      confirmedRegistrationCount: playerCount,
      updatedAt: now,
    });
    return ids;
  });
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });

  return { tournamentId, registrationIds };
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
// drop-flow tests don't depend on which pairing the seeded shuffle produced.
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

// The match document, its player rows, and its full revision history.
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
