/// <reference types="vite/client" />

// The normalized adjudication model: immutable result revisions with a
// current pointer, drawn games flowing through scoring per MTR Appendix C,
// bye exclusion from the percentages a player feeds opponents' tiebreakers,
// and the seed-derived residual tiebreak. See CONTEXT.md.
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { matchLogForRegistration } from "./model/playerResults";
import { currentMatchForPlayer } from "./model/playerView";
import { tiebreakRandom } from "./model/random";
import { matchPlayers } from "./model/tournaments";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

test("tiebreakRandom is a pure function of seed and key", () => {
  expect(tiebreakRandom(42, "abc")).toBe(tiebreakRandom(42, "abc"));
  expect(tiebreakRandom(42, "abc")).not.toBe(tiebreakRandom(43, "abc"));
  expect(tiebreakRandom(42, "abc")).not.toBe(tiebreakRandom(42, "abd"));
  expect(Number.isInteger(tiebreakRandom(7, "x"))).toBe(true);
});

test("result revisions record adjudication history with a current pointer", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Revision Event",
      dummyPlayerCount: 5,
      roundsToGenerate: 3,
      seed: 31,
      autoStart: true,
    },
  );

  const roundOne = await organizer.query(
    api.tournaments.rounds.getCurrentRound,
    {
      tournamentId,
    },
  );
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: roundOne!._id },
  );
  const byeRow = pairings.find(({ players }) => players[0].isBye);
  const [first, second] = pairings.filter(
    ({ players }) => players.length === 2,
  );
  const resultArgs = (row: typeof first) => ({
    matchId: row.match._id,
    playerOneRegistrationId: row.players[0].playerId,
    playerTwoRegistrationId: row.players[1].playerId,
  });

  // A pairing-time bye is itself a revision: one awarded win, no actor.
  const byeRevisions = await t.run(async (ctx) =>
    ctx.db
      .query("matchResultRevisions")
      .withIndex("by_tournamentMatchId", (q) =>
        q.eq("tournamentMatchId", byeRow!.match._id),
      )
      .collect(),
  );
  expect(byeRevisions).toHaveLength(1);
  expect(byeRevisions[0]).toMatchObject({
    kind: "bye",
    lines: [
      {
        outcome: "win",
        matchPointsEarned: 3,
        gameWins: 2,
        gameLosses: 0,
        gameDraws: 0,
      },
    ],
  });
  expect(byeRevisions[0].actorUserId).toBeUndefined();
  const byeMatch = await t.run(async (ctx) => ctx.db.get(byeRow!.match._id));
  expect(byeMatch?.currentResultRevisionId).toBe(byeRevisions[0]._id);

  // An organizer entry followed by a correction appends — never rewrites —
  // and moves the current pointer to the newest revision.
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    ...resultArgs(first),
    playerOneGameWins: 2,
    playerTwoGameWins: 1,
  });
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    ...resultArgs(first),
    playerOneGameWins: 1,
    playerTwoGameWins: 1,
    gameDraws: 1,
    note: "Table reported the wrong score",
  });
  const revisions = await t.run(async (ctx) =>
    ctx.db
      .query("matchResultRevisions")
      .withIndex("by_tournamentMatchId", (q) =>
        q.eq("tournamentMatchId", first.match._id),
      )
      .collect(),
  );
  expect(revisions).toHaveLength(2);
  const [original, correction] = revisions;
  expect(original).toMatchObject({
    kind: "played",
    actorRole: "organizer",
    lines: [
      { outcome: "win", matchPointsEarned: 3, gameWins: 2, gameLosses: 1 },
      { outcome: "loss", matchPointsEarned: 0, gameWins: 1, gameLosses: 2 },
    ],
  });
  expect(original.note).toBeUndefined();
  expect(correction).toMatchObject({
    kind: "played",
    note: "Table reported the wrong score",
    lines: [
      {
        outcome: "draw",
        matchPointsEarned: 1,
        gameWins: 1,
        gameLosses: 1,
        gameDraws: 1,
      },
      {
        outcome: "draw",
        matchPointsEarned: 1,
        gameWins: 1,
        gameLosses: 1,
        gameDraws: 1,
      },
    ],
  });
  expect(correction.actorUserId).toBeDefined();
  const firstMatch = await t.run(async (ctx) => ctx.db.get(first.match._id));
  expect(firstMatch?.currentResultRevisionId).toBe(correction._id);

  // Drawn games are bounded by the flat cap.
  await expect(
    organizer.mutation(api.tournaments.rounds.recordMatchResult, {
      ...resultArgs(second),
      playerOneGameWins: 0,
      playerTwoGameWins: 0,
      gameDraws: 4,
    }),
  ).rejects.toThrow("A match can record at most 3 drawn games");
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    ...resultArgs(second),
    playerOneGameWins: 2,
    playerTwoGameWins: 0,
  });

  // Rewinding an un-played round deletes its matches' revisions with it.
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: roundOne!._id,
  });
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const orphaned = await t.run(async (ctx) => {
    const all = await ctx.db.query("matchResultRevisions").collect();
    const missing: Doc<"matchResultRevisions">[] = [];
    for (const revision of all) {
      if ((await ctx.db.get(revision.tournamentMatchId)) === null) {
        missing.push(revision);
      }
    }
    return missing;
  });
  expect(orphaned).toHaveLength(0);
});

test("standings compute point-based percentages with draws and bye-excluded feeds", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Appendix C Event",
      dummyPlayerCount: 3,
      roundsToGenerate: 2,
      seed: 17,
      autoStart: true,
    },
  );

  // Round 1: B takes the bye; X beats Y 2–1 with one drawn game.
  const roundOne = await organizer.query(
    api.tournaments.rounds.getCurrentRound,
    {
      tournamentId,
    },
  );
  const roundOnePairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: roundOne!._id },
  );
  const byeId = roundOnePairings.find(({ players }) => players[0].isBye)!
    .players[0].playerId;
  const played = roundOnePairings.find(({ players }) => players.length === 2)!;
  const xId = played.players[0].playerId;
  const yId = played.players[1].playerId;
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: played.match._id,
    playerOneRegistrationId: xId,
    playerTwoRegistrationId: yId,
    playerOneGameWins: 2,
    playerTwoGameWins: 1,
    gameDraws: 1,
  });
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: roundOne!._id,
  });

  // Round 2: Y (lowest rank, no bye yet) takes the bye; X beats B 2–0.
  const roundTwoId = await organizer.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const roundTwoPairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: roundTwoId },
  );
  const roundTwoBye = roundTwoPairings.find(({ players }) => players[0].isBye)!;
  expect(roundTwoBye.players[0].playerId).toBe(yId);
  const roundTwoMatch = roundTwoPairings.find(
    ({ players }) => players.length === 2,
  )!;
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: roundTwoMatch.match._id,
    playerOneRegistrationId: xId,
    playerTwoRegistrationId: byeId,
    playerOneGameWins: 2,
    playerTwoGameWins: 0,
  });
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: roundTwoId,
  });

  const standings = (
    await organizer.query(api.tournaments.rounds.listRoundStandings, {
      roundId: roundTwoId,
    })
  ).map(({ standing }) => standing);
  const byPlayer = new Map(standings.map((row) => [row.playerId, row]));
  const x = byPlayer.get(xId)!;
  const y = byPlayer.get(yId)!;
  const b = byPlayer.get(byeId)!;

  // X: 4W–1L–1D across six games = (4×3 + 1) / (6×3) game points — the
  // drawn game counts toward both sides of the division.
  expect(x.matchPoints).toBe(6);
  expect(x.gameDraws).toBe(1);
  expect(x.gameWinPct).toBeCloseTo(13 / 18, 10);
  // Both of X's opponents fed a bye-excluded match-win percentage of 0
  // (each's only match points came from a bye), floored at 0.33. Including
  // byes would have made B feed 0.5.
  expect(x.opponentMatchWinPct).toBeCloseTo(0.33, 10);
  // Y feeds (1×3 + 1) / (4×3) with bye games excluded; B feeds the floor.
  expect(x.opponentGameWinPct).toBeCloseTo((1 / 3 + 0.33) / 2, 10);

  // B's own game-win percentage keeps the bye's awarded games (2–0):
  // (2×3) / (4×3), not the 0 a bye-excluded reading would give.
  expect(b.matchPoints).toBe(3);
  expect(b.byeCount).toBe(1);
  expect(b.gameWinPct).toBeCloseTo(0.5, 10);
  expect(b.opponentMatchWinPct).toBeCloseTo(1, 10);
  expect(b.opponentGameWinPct).toBeCloseTo(13 / 18, 10);

  // Y: 3W–2L–1D including the bye = (3×3 + 1) / (6×3) own game points.
  expect(y.matchPoints).toBe(3);
  expect(y.gameWinPct).toBeCloseTo(10 / 18, 10);
  expect(y.opponentMatchWinPct).toBeCloseTo(1, 10);

  // Y and B tie on match points and opponents' match-win percentage; Y's
  // higher game-win percentage breaks the tie.
  expect(standings.map((row) => row.playerId)).toEqual([xId, yId, byeId]);
});

test("the match log and player view read the stored outcome, not game counts", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId = await organizer.mutation(
    api.tournaments.testing.createTestTournament,
    {
      organizationId,
      name: "Double Loss Event",
      dummyPlayerCount: 4,
      roundsToGenerate: 3,
      seed: 47,
      autoStart: true,
    },
  );
  const round = await organizer.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round!._id },
  );
  const table = pairings.find(({ players }) => players.length === 2)!;

  // Record a no_show double match loss the way the judge writer will (the
  // kind is reserved in matchResultKindValidator): both lines stored as
  // losses at 0–0 — game counts that, compared, would read as a draw.
  const registrationId = await t.run(async (ctx) => {
    const players = await matchPlayers(ctx, table.match._id);
    const now = Date.now();
    const revisionId = await ctx.db.insert("matchResultRevisions", {
      tournamentId,
      tournamentMatchId: table.match._id,
      kind: "no_show",
      lines: players.map((player) => ({
        registrationId: player.playerId,
        outcome: "loss" as const,
        matchPointsEarned: 0,
        gameWins: 0,
        gameLosses: 0,
        gameDraws: 0,
      })),
    });
    for (const player of players) {
      await ctx.db.patch(player._id, {
        matchPointsEarned: 0,
        gameWins: 0,
        gameLosses: 0,
        gameDraws: 0,
        updatedAt: now,
      });
    }
    await ctx.db.patch(table.match._id, {
      matchStatus: "completed",
      currentResultRevisionId: revisionId,
      currentResultKind: "no_show",
      updatedAt: now,
    });
    // The player-facing surfaces below only list rounds whose pairings are
    // visible; the dummy-player harness does not need them published.
    await ctx.db.patch(round!._id, { pairingsPublishedAt: now });
    return players[0].playerId;
  });

  // Both surfaces label the result from the stored line — "loss", never the
  // "draw" that comparing 0 = 0 game counts would derive.
  const history = await t.run(
    async (ctx) =>
      await matchLogForRegistration(ctx, tournamentId, registrationId),
  );
  const historyRow = history.find(
    (entry) => entry.roundNumber === round!.roundNumber,
  );
  expect(historyRow?.result).toBe("loss");

  const view = await t.run(async (ctx) => {
    const tournament = await ctx.db.get(tournamentId);
    const registration = await ctx.db.get(registrationId);
    return await currentMatchForPlayer(ctx, tournament!, registration!);
  });
  if (view.kind !== "match") {
    throw new Error("Expected the completed match to be visible");
  }
  expect(view.me.outcome).toBe("loss");
});
