/// <reference types="vite/client" />

import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  eliminateNonQualifiers,
  setRegistrationState,
} from "./model/participation";
import { compareStandingRows } from "./model/standings";
import schema from "./schema";
import {
  currentRound,
  matchForPlayer,
  opponentNumber,
  organizerIdentity,
  outsiderNumber,
  playOutCurrentRound,
  playerIdentity,
  seedTournamentWithPlayers,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

test("reportMyMatchResult records the result for both players", async () => {
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
  const t = createConvexTest();
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
    t
      .withIdentity(playerIdentity(outsider))
      .mutation(api.tournaments.player.reportMyMatchResult, {
        matchId: match._id,
        myGameWins: 2,
        opponentGameWins: 0,
      }),
  ).rejects.toThrow("You are not part of this match");

  await expect(
    t
      .withIdentity(playerIdentity(99))
      .mutation(api.tournaments.player.reportMyMatchResult, {
        matchId: match._id,
        myGameWins: 2,
        opponentGameWins: 0,
      }),
  ).rejects.toThrow("Not registered for this tournament");

  await expect(
    t
      .withIdentity(playerIdentity(5))
      .mutation(api.tournaments.player.reportMyMatchResult, {
        matchId: byeMatch._id,
        myGameWins: 2,
        opponentGameWins: 0,
      }),
  ).rejects.toThrow("Only two-player matches can be reported by players");

  await expect(
    t
      .withIdentity(playerIdentity(1))
      .mutation(api.tournaments.player.reportMyMatchResult, {
        matchId: match._id,
        myGameWins: 3,
        opponentGameWins: 0,
      }),
  ).rejects.toThrow("A best-of-3 match is won at 2 game wins");

  await expect(
    t
      .withIdentity(playerIdentity(1))
      .mutation(api.tournaments.player.reportMyMatchResult, {
        matchId: match._id,
        myGameWins: 2,
        opponentGameWins: 2,
      }),
  ).rejects.toThrow("Game wins can total at most 3 in a best-of-3 match");

  await expect(
    t
      .withIdentity(playerIdentity(1))
      .mutation(api.tournaments.player.reportMyMatchResult, {
        matchId: match._id,
        myGameWins: -1,
        opponentGameWins: 0,
      }),
  ).rejects.toThrow("Game wins must be a whole number of 0 or more");

  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: match._id,
      myGameWins: 2,
      opponentGameWins: 0,
    });
  await expect(
    t
      .withIdentity(playerIdentity(opponent))
      .mutation(api.tournaments.player.reportMyMatchResult, {
        matchId: match._id,
        myGameWins: 2,
        opponentGameWins: 0,
      }),
  ).rejects.toThrow("Match already has a result");
});

test("a report counts immediately and an organizer override supersedes it", async () => {
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
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: match._id,
      myGameWins: 2,
      opponentGameWins: 1,
    });
  let stored = await t.run(async (ctx) => await ctx.db.get(match._id));
  expect(stored?.matchStatus).toBe("completed");
  expect(stored?.reportedByRegistrationId).toBe(registrationIds[0]);

  // There is no confirmation step: disputes resolve through an organizer
  // override, which clears the reporter stamp and makes the result
  // organizer-final.
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
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const round = await currentRound(t, tournamentId);
  const matchOne = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  // The other table is whichever match player 1 is not in.
  const otherNumber = await outsiderNumber(t, matchOne._id, registrationIds);
  const matchTwo = await matchForPlayer(
    t,
    tournamentId,
    1,
    registrationIds[otherNumber - 1],
  );

  // Both tables report; each report counts as a result immediately.
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: matchOne._id,
      myGameWins: 2,
      opponentGameWins: 0,
    });
  await t
    .withIdentity(playerIdentity(otherNumber))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: matchTwo._id,
      myGameWins: 2,
      opponentGameWins: 1,
    });

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

test("playoff standings lock placements by elimination round", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournament(t, 12, [
    {
      phaseOrder: 1,
      phaseType: "swiss",
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
    },
    {
      phaseOrder: 2,
      phaseType: "single_elimination",
      phaseRoundMode: "fixed",
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  const swissRound = await currentRound(t, tournamentId);
  const swissStandings = (
    await organizer.query(api.tournaments.rounds.listRoundStandings, {
      roundId: swissRound._id,
    })
  ).map(({ standing }) => standing);
  expect(swissStandings).toHaveLength(12);
  const cutPlayerIds = swissStandings.slice(8).map((row) => row.playerId);
  const cutPlayerNumber = registrationIds.indexOf(cutPlayerIds[0]) + 1;

  const quarterfinalId = await organizer.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const quarterfinals = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: quarterfinalId },
  );
  const quarterfinalWinnerIds = quarterfinals.map(
    ({ players }) => players[0].playerId,
  );
  const quarterfinalLoserIds = quarterfinals.map(
    ({ players }) => players[1].playerId,
  );
  await playOutCurrentRound(t, tournamentId);

  let standings = await t
    .withIdentity(playerIdentity(cutPlayerNumber))
    .query(api.tournaments.player.getLatestStandings, { tournamentId });
  expect(standings?.roundNumber).toBe(2);
  expect(standings?.rows).toHaveLength(12);
  expect(standings?.rows.some((row) => row.isMe)).toBe(true);
  expect(standings?.rows.slice(0, 4).map((row) => row.playoffStatus)).toEqual([
    "active",
    "active",
    "active",
    "active",
  ]);
  expect(new Set(standings?.rows.slice(0, 4).map((row) => row.name))).toEqual(
    new Set(
      quarterfinalWinnerIds.map(
        (id) => `Player ${registrationIds.indexOf(id) + 1}`,
      ),
    ),
  );
  expect(standings?.rows.slice(4, 8).map((row) => row.playoffStatus)).toEqual([
    "eliminated",
    "eliminated",
    "eliminated",
    "eliminated",
  ]);
  expect(
    standings?.rows.slice(4, 8).map((row) => row.eliminatedInRoundNumber),
  ).toEqual([2, 2, 2, 2]);
  // The payload does not expose the seed-derived tiebreak, so the sort check
  // uses a stable index tiebreak: rows that tie on every public tiebreaker
  // keep their returned order, and any misordering of the public tiebreakers
  // still fails.
  const quarterfinalLoserRows = (standings?.rows.slice(4, 8) ?? []).map(
    (row, index) => ({
      row,
      comparable: { ...row, tiebreakRandom: 0, tiebreakId: String(index) },
    }),
  );
  expect(quarterfinalLoserRows.map(({ row }) => row)).toEqual(
    [...quarterfinalLoserRows]
      .sort((left, right) =>
        compareStandingRows(left.comparable, right.comparable),
      )
      .map(({ row }) => row),
  );
  expect(standings?.rows.slice(8).map((row) => row.playoffStatus)).toEqual([
    "cut",
    "cut",
    "cut",
    "cut",
  ]);

  const semifinalId = await organizer.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const semifinals = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: semifinalId },
  );
  const semifinalWinnerIds = semifinals.map(
    ({ players }) => players[0].playerId,
  );
  const semifinalLoserIds = semifinals.map(
    ({ players }) => players[1].playerId,
  );
  await playOutCurrentRound(t, tournamentId);

  const quarterfinalLoserNumber =
    registrationIds.indexOf(quarterfinalLoserIds[0]) + 1;
  standings = await t
    .withIdentity(playerIdentity(quarterfinalLoserNumber))
    .query(api.tournaments.player.getLatestStandings, { tournamentId });
  expect(standings?.roundNumber).toBe(3);
  expect(standings?.rows).toHaveLength(12);
  expect(standings?.rows.some((row) => row.isMe)).toBe(true);
  expect(new Set(standings?.rows.slice(0, 2).map((row) => row.name))).toEqual(
    new Set(
      semifinalWinnerIds.map(
        (id) => `Player ${registrationIds.indexOf(id) + 1}`,
      ),
    ),
  );
  expect(new Set(standings?.rows.slice(2, 4).map((row) => row.name))).toEqual(
    new Set(
      semifinalLoserIds.map(
        (id) => `Player ${registrationIds.indexOf(id) + 1}`,
      ),
    ),
  );
  expect(
    standings?.rows.slice(2, 4).map((row) => row.eliminatedInRoundNumber),
  ).toEqual([3, 3]);
  expect(
    standings?.rows.slice(4, 8).map((row) => row.eliminatedInRoundNumber),
  ).toEqual([2, 2, 2, 2]);
  expect(standings?.rows.slice(8).map((row) => row.playoffStatus)).toEqual([
    "cut",
    "cut",
    "cut",
    "cut",
  ]);
});

test("getMyCurrentMatch walks the tournament lifecycle", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournament(t, 4);
  const playerOne = t.withIdentity(playerIdentity(1));

  let current = await playerOne.query(
    api.tournaments.player.getMyCurrentMatch,
    {
      tournamentId,
    },
  );
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
  expect(current.match.currentResultKind).toBe("played");
  // The player's side of the result comes from the stored revision line, so
  // clients render it without re-deriving win/loss from game counts.
  expect(current.me.outcome).toBe("win");

  const round = await currentRound(t, tournamentId);
  const otherNumber = await outsiderNumber(
    t,
    current.match._id,
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

test("pairings stay private until published and auto-publish applies to future rounds", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournament(
    t,
    4,
    [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 2 }],
    false,
  );
  const organizer = t.withIdentity(organizerIdentity);
  const playerOne = t.withIdentity(playerIdentity(1));

  const setup = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(setup.tournament.autoPublishPairings).toBe(false);

  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const roundOne = await currentRound(t, tournamentId);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);

  expect(
    await playerOne.query(api.tournaments.player.getMyCurrentMatch, {
      tournamentId,
    }),
  ).toMatchObject({ kind: "pairings_pending", round: { roundNumber: 1 } });
  expect(
    await playerOne.query(api.tournaments.player.getMyMatchHistory, {
      tournamentId,
    }),
  ).toEqual([]);
  await expect(
    playerOne.mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: match._id,
      myGameWins: 2,
      opponentGameWins: 0,
    }),
  ).rejects.toThrow("Pairings have not been published");
  expect(
    await organizer.query(api.tournaments.rounds.getPairingsBoard, {
      tournamentId,
    }),
  ).toMatchObject({
    nextStep: { kind: "publishPairings", roundId: roundOne._id, ready: true },
  });

  await organizer.mutation(api.tournaments.rounds.publishPairings, {
    roundId: roundOne._id,
  });
  expect(
    await playerOne.query(api.tournaments.player.getMyCurrentMatch, {
      tournamentId,
    }),
  ).toMatchObject({ kind: "match", round: { roundNumber: 1 } });

  await organizer.mutation(
    api.tournaments.lifecycle.updatePairingsAutoPublish,
    { tournamentId, autoPublishPairings: true },
  );
  await playOutCurrentRound(t, tournamentId);
  const roundTwoId = await organizer.mutation(
    api.tournaments.rounds.generateNextRound,
    { tournamentId },
  );
  const roundTwo = await t.run(async (ctx) => await ctx.db.get(roundTwoId));
  expect(roundTwo?.pairingsPublishedAt).toEqual(expect.any(Number));
  expect(
    await playerOne.query(api.tournaments.player.getMyCurrentMatch, {
      tournamentId,
    }),
  ).toMatchObject({ kind: "match", round: { roundNumber: 2 } });
});

test("unpublished rounds do not promise pairings to excluded players", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournament(
    t,
    4,
    [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
    false,
  );
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: registrationIds[3],
  });
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });

  expect(
    await t
      .withIdentity(playerIdentity(1))
      .query(api.tournaments.player.getMyCurrentMatch, { tournamentId }),
  ).toMatchObject({ kind: "pairings_pending" });
  await expect(
    t
      .withIdentity(playerIdentity(4))
      .query(api.tournaments.player.getMyCurrentMatch, { tournamentId }),
  ).rejects.toThrow("Not registered for this tournament");
});

test("completing unpublished pairings preserves the round in match history", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(
    t,
    4,
    [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 2 }],
    false,
  );
  const organizer = t.withIdentity(organizerIdentity);
  const playerOne = t.withIdentity(playerIdentity(1));

  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const roundOne = await currentRound(t, tournamentId);
  expect(roundOne.pairingsPublishedAt).toBeUndefined();

  // Organizers can enter results before publishing pairings. Completing the
  // round must make that final record visible before the current round moves.
  await playOutCurrentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  const completedRound = await t.run(
    async (ctx) => await ctx.db.get(roundOne._id),
  );
  expect(completedRound?.pairingsPublishedAt).toEqual(expect.any(Number));
  expect(
    await playerOne.query(api.tournaments.player.getMyMatchHistory, {
      tournamentId,
    }),
  ).toMatchObject([{ roundNumber: 1 }]);
});

test("isFinalRound is only true in the tournament's last phase", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, 4, [
    { phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 },
    { phaseOrder: 2, phaseRoundMode: "fixed", phaseTotalRounds: 1 },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  const playerOne = t.withIdentity(playerIdentity(1));
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });

  // Phase 1's last round is not the tournament's final round: phase 2 still
  // has rounds to play.
  let current = await playerOne.query(
    api.tournaments.player.getMyCurrentMatch,
    {
      tournamentId,
    },
  );
  if (current.kind === "not_started" || current.kind === "player_meeting") {
    throw new Error("Expected the tournament to have started");
  }
  expect(current.kind).toBe("match");
  expect(current.round.isFinalRound).toBe(false);

  // Between phases the player is waiting on the next phase, not done.
  await playOutCurrentRound(t, tournamentId);
  current = await playerOne.query(api.tournaments.player.getMyCurrentMatch, {
    tournamentId,
  });
  if (current.kind === "not_started" || current.kind === "player_meeting") {
    throw new Error("Expected the tournament to have started");
  }
  expect(current.kind).toBe("between_rounds");
  expect(current.round.isFinalRound).toBe(false);

  // Phase 2's only round is the tournament's final round.
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  current = await playerOne.query(api.tournaments.player.getMyCurrentMatch, {
    tournamentId,
  });
  if (current.kind === "not_started" || current.kind === "player_meeting") {
    throw new Error("Expected the tournament to have started");
  }
  expect(current.kind).toBe("match");
  expect(current.round.isFinalRound).toBe(true);
});

test("getMyMatchHistory reports per-round outcomes", async () => {
  const t = createConvexTest();
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
  const t = createConvexTest();
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

  // Dropped players keep read access and stay ranked with their frozen
  // record, marked by their live registration status.
  const current = await playerFour.query(
    api.tournaments.player.getMyCurrentMatch,
    { tournamentId },
  );
  expect(current.myRegistrationStatus).toBe("dropped");
  const standings = await playerFour.query(
    api.tournaments.player.getLatestStandings,
    { tournamentId },
  );
  expect(standings?.rows).toHaveLength(4);
  const myRow = standings?.rows.find((row) => row.isMe);
  expect(myRow).toMatchObject({
    registrationStatus: "dropped",
    matchWins: 0,
    matchLosses: 1,
  });

  // A disqualification is reported as-is on every surface — player-facing
  // queries and the organizer standings query all return the real status.
  // Disqualification has no mutation of its own yet, so this stands in for
  // the planned one by going through the single transition funnel a writer
  // would use — which is also what keeps the standings row's denormalized
  // copy current.
  await t.run(async (ctx) => {
    await setRegistrationState(ctx, registrationIds[3], {
      entryStatus: "confirmed",
      participationStatus: "disqualified",
    });
  });
  const standingsAfterDq = await playerFour.query(
    api.tournaments.player.getLatestStandings,
    { tournamentId },
  );
  expect(
    standingsAfterDq?.rows.find((row) => row.isMe)?.registrationStatus,
  ).toBe("disqualified");
  const currentAfterDq = await playerFour.query(
    api.tournaments.player.getMyCurrentMatch,
    { tournamentId },
  );
  expect(currentAfterDq.myRegistrationStatus).toBe("disqualified");
  const organizerStandings = await organizer.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: round._id },
  );
  expect(
    organizerStandings.find(
      (row) => row.standing.playerId === registrationIds[3],
    )?.registrationStatus,
  ).toBe("disqualified");
});

// getLatestStandings reads participation status from the copy denormalized onto
// the standings row instead of scanning every non-active registration, so the
// cases that matter are the ones where the status changes AFTER the standings
// that display it were written: a drop, a reinstate, and a cut's elimination
// batch. Each test checks both what the player sees and what is stored on the
// row, since a stale stored value is what would break the query.
test("standings track a drop and a reinstate made between rounds", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);
  const viewer = t.withIdentity(playerIdentity(1));
  const droppedId = registrationIds[3];

  await playOutCurrentRound(t, tournamentId);
  const roundOne = await currentRound(t, tournamentId);
  expect(
    (
      await viewer.query(api.tournaments.player.getLatestStandings, {
        tournamentId,
      })
    )?.rows.map((row) => row.registrationStatus),
  ).toEqual(["active", "active", "active", "active"]);

  // Between rounds: round one's standings are already written and are what
  // every player is looking at when the drop lands.
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: droppedId,
  });
  let standings = await viewer.query(
    api.tournaments.player.getLatestStandings,
    { tournamentId },
  );
  expect(standings?.roundNumber).toBe(1);
  expect(
    standings?.rows.find((row) => row.name === "Player 4")?.registrationStatus,
  ).toBe("dropped");
  expect(await storedStandingStatus(t, roundOne._id, droppedId)).toBe(
    "dropped",
  );

  // ...and the reinstate has to travel the same way back.
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    { registrationId: droppedId },
  );
  standings = await viewer.query(api.tournaments.player.getLatestStandings, {
    tournamentId,
  });
  expect(standings?.roundNumber).toBe(1);
  expect(
    standings?.rows.find((row) => row.name === "Player 4")?.registrationStatus,
  ).toBe("active");
  expect(await storedStandingStatus(t, roundOne._id, droppedId)).toBe("active");

  // A drop taken while the next round is being played still has to show on the
  // last completed round's standings, which are the ones on screen.
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: registrationIds[2],
  });
  standings = await viewer.query(api.tournaments.player.getLatestStandings, {
    tournamentId,
  });
  expect(standings?.roundNumber).toBe(1);
  expect(
    standings?.rows.find((row) => row.name === "Player 3")?.registrationStatus,
  ).toBe("dropped");
  expect(await storedStandingStatus(t, roundOne._id, registrationIds[2])).toBe(
    "dropped",
  );

  // Completing that round writes fresh standings, which must carry the drop
  // forward rather than reverting to the status held when play began.
  await playOutCurrentRound(t, tournamentId);
  const roundTwo = await currentRound(t, tournamentId);
  standings = await viewer.query(api.tournaments.player.getLatestStandings, {
    tournamentId,
  });
  expect(standings?.roundNumber).toBe(2);
  expect(
    standings?.rows.find((row) => row.name === "Player 3")?.registrationStatus,
  ).toBe("dropped");
  expect(await storedStandingStatus(t, roundTwo._id, registrationIds[2])).toBe(
    "dropped",
  );
});

test("standings show a cut's elimination batch on the round that produced it", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournament(t, 4, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff: { kind: "top_X_players", playerCount: 2 },
    },
    { phaseOrder: 2, phaseRoundMode: "fixed", phaseTotalRounds: 1 },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  const viewer = t.withIdentity(playerIdentity(1));
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });

  await playOutCurrentRound(t, tournamentId);
  const finalSwissRound = await currentRound(t, tournamentId);
  const qualifierIds = (
    await organizer.query(api.tournaments.rounds.listRoundStandings, {
      roundId: finalSwissRound._id,
    })
  )
    .slice(0, 2)
    .map(({ standing }) => standing.playerId);
  const eliminatedIds = registrationIds.filter(
    (registrationId) => !qualifierIds.includes(registrationId),
  );
  expect(eliminatedIds).toHaveLength(2);

  // The cut is applied while the next phase's first round is paired — after
  // this round's standings were written, and before the next round has any.
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const standings = await viewer.query(
    api.tournaments.player.getLatestStandings,
    { tournamentId },
  );
  expect(standings?.roundNumber).toBe(finalSwissRound.roundNumber);
  for (const eliminatedId of eliminatedIds) {
    expect(
      await storedStandingStatus(t, finalSwissRound._id, eliminatedId),
    ).toBe("eliminated");
  }
  for (const qualifierId of qualifierIds) {
    expect(
      await storedStandingStatus(t, finalSwissRound._id, qualifierId),
    ).toBe("active");
  }
  // The organizer view of the same round still live-joins the registration, so
  // the denormalized copy the players read has to agree with it row for row.
  const liveStatusByName = new Map(
    (
      await organizer.query(api.tournaments.rounds.listRoundStandings, {
        roundId: finalSwissRound._id,
      })
    ).map((row) => [row.playerName, row.registrationStatus]),
  );
  expect(liveStatusByName.size).toBe(4);
  expect(standings?.rows.map((row) => row.registrationStatus)).toEqual(
    standings?.rows.map((row) => liveStatusByName.get(row.name ?? undefined)),
  );
  expect(
    standings?.rows.filter((row) => row.registrationStatus === "eliminated"),
  ).toHaveLength(2);
});

// The elimination batch a cut applies removes the whole field bar the
// qualifiers in one transaction. Writing each of those status changes through
// to the standings by looking the player's row up on its own would cost an
// index range per eliminated player — at MAX_TOURNAMENT_PLAYERS, half the
// 4,096-range-per-transaction budget from one helper. The rows it needs all
// belong to the round the cut was drawn from, so one range serves the batch
// however large the field is. Counting the reads is the only way to see this:
// both shapes leave exactly the same rows on disk.
test("a cut's elimination batch reaches standings through one index range", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournament(t, 8, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff: { kind: "top_X_players", playerCount: 2 },
    },
    { phaseOrder: 2, phaseRoundMode: "fixed", phaseTotalRounds: 1 },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);
  const finalSwissRound = await currentRound(t, tournamentId);
  const qualifierIds = (
    await organizer.query(api.tournaments.rounds.listRoundStandings, {
      roundId: finalSwissRound._id,
    })
  )
    .slice(0, 2)
    .map(({ standing }) => standing.playerId);
  const eliminatedIds = registrationIds.filter(
    (registrationId) => !qualifierIds.includes(registrationId),
  );
  expect(eliminatedIds).toHaveLength(6);

  const tally = await t.run(async (ctx) => {
    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) {
      throw new Error("Tournament missing in test setup");
    }
    const qualifiers = [];
    for (const qualifierId of qualifierIds) {
      const registration = await ctx.db.get(qualifierId);
      if (!registration) {
        throw new Error("Qualifier missing in test setup");
      }
      qualifiers.push(registration);
    }
    const standingIds = new Set(
      (
        await ctx.db
          .query("roundStandings")
          .withIndex("by_tournamentRoundId_and_rank", (q) =>
            q.eq("tournamentRoundId", finalSwissRound._id),
          )
          .collect()
      ).map((standing) => standing._id as string),
    );

    // Every roundStandings query opens exactly one index range, so counting the
    // calls counts the ranges; patches are attributed by row id.
    const counts = { standingsRanges: 0, standingsPatches: 0 };
    const db = new Proxy(ctx.db, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (typeof value !== "function") {
          return value;
        }
        return (...args: unknown[]) => {
          if (property === "query" && args[0] === "roundStandings") {
            counts.standingsRanges += 1;
          }
          if (property === "patch" && standingIds.has(args[0] as string)) {
            counts.standingsPatches += 1;
          }
          return (value as (...inner: unknown[]) => unknown).apply(
            target,
            args,
          );
        };
      },
    });
    const countingCtx = new Proxy(ctx, {
      get: (target, property) =>
        property === "db" ? db : Reflect.get(target, property, target),
    });

    await eliminateNonQualifiers(
      countingCtx as unknown as MutationCtx,
      tournament,
      // elimination: null is the seat-decided-cut shape — the partition read
      // no standings — so the helper's own prefetch is what is being counted.
      {
        qualifiers,
        droppedNonQualifiers: [],
        heldPlaces: [],
        elimination: null,
      },
      finalSwissRound._id,
    );
    return counts;
  });

  expect(tally.standingsRanges).toBe(1);
  expect(tally.standingsPatches).toBe(eliminatedIds.length);
  // …and the denormalized copy is still exact, which is what the range buys.
  for (const eliminatedId of eliminatedIds) {
    expect(
      await storedStandingStatus(t, finalSwissRound._id, eliminatedId),
    ).toBe("eliminated");
  }
  for (const qualifierId of qualifierIds) {
    expect(
      await storedStandingStatus(t, finalSwissRound._id, qualifierId),
    ).toBe("active");
  }
});

test("a rewind past a drop does not resurrect the dropped player", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);
  const viewer = t.withIdentity(playerIdentity(1));
  const droppedId = registrationIds[3];

  await playOutCurrentRound(t, tournamentId);
  const roundOne = await currentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  // The drop lands while round two's standings are the ones on screen, so only
  // they record it — round one's were frozen before it happened.
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: droppedId,
  });
  expect(await storedStandingStatus(t, roundOne._id, droppedId)).toBe("active");

  // Rewinding round three reopens round two and deletes its standings, handing
  // round one's back to every player.
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const standings = await viewer.query(
    api.tournaments.player.getLatestStandings,
    { tournamentId },
  );
  expect(standings?.roundNumber).toBe(1);
  expect(
    standings?.rows.find((row) => row.name === "Player 4")?.registrationStatus,
  ).toBe("dropped");
  expect(await storedStandingStatus(t, roundOne._id, droppedId)).toBe(
    "dropped",
  );
});

// The tests above pin the write side: the participation module keeps the
// denormalized copy exact. This pins the read side — getLatestStandings
// believes the row rather than live-joining registrations. Severing the copy
// from the registration (patching the row directly, behind the participation
// module's back) changes what players see even though no registration
// changed; a query that joined registrations would report the drop anyway,
// and would pay a document read and a subscription dependency per non-active
// player, per viewer, to do it.
test("getLatestStandings reports the status stored on the row, not the registration", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);
  const viewer = t.withIdentity(playerIdentity(1));
  const droppedId = registrationIds[3];

  await playOutCurrentRound(t, tournamentId);
  const roundOne = await currentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: droppedId,
  });
  expect(await storedStandingStatus(t, roundOne._id, droppedId)).toBe(
    "dropped",
  );

  await t.run(async (ctx) => {
    const standing = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_playerId", (q) =>
        q.eq("tournamentRoundId", roundOne._id).eq("playerId", droppedId),
      )
      .unique();
    if (!standing) {
      throw new Error("Standings row not found in test setup");
    }
    await ctx.db.patch(standing._id, { participationStatus: "active" });
  });

  const standings = await viewer.query(
    api.tournaments.player.getLatestStandings,
    { tournamentId },
  );
  expect(
    standings?.rows.find((row) => row.name === "Player 4")?.registrationStatus,
  ).toBe("active");
});

// The participation status stored on a round's standings row, which is what
// getLatestStandings reports.
async function storedStandingStatus(
  t: TestConvex<typeof schema>,
  roundId: Id<"tournamentRounds">,
  registrationId: Id<"tournamentRegistrations">,
) {
  return await t.run(async (ctx) => {
    const standing = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_playerId", (q) =>
        q.eq("tournamentRoundId", roundId).eq("playerId", registrationId),
      )
      .unique();
    if (!standing) {
      throw new Error("Standings row not found in test setup");
    }
    return standing.participationStatus ?? null;
  });
}

test("player queries reject users who never registered", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedStartedTournament(t, 4);
  const outsider = t.withIdentity(playerIdentity(99));

  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      tokenIdentifier: playerIdentity(99).tokenIdentifier,
      publicCode: 99,
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

async function seedTournament(
  t: TestConvex<typeof schema>,
  playerCount: number,
  phases?: {
    phaseOrder: number;
    phaseType?: "swiss" | "single_elimination";
    phaseRoundMode: "fixed" | "dynamic";
    phaseTotalRounds?: number;
    phaseCutoff?:
      | { kind: "top_X_players"; playerCount: number }
      | { kind: "X_points_or_more"; matchPoints: number };
  }[],
  autoPublishPairings = true,
) {
  return await seedTournamentWithPlayers(t, {
    name: "Player Controller Event",
    playerCount,
    phases,
    autoPublishPairings,
    // Descending so equal records rank in player-number order, keeping this
    // suite's pairing expectations stable; tiebreak realism lives in the
    // pairing and swiss suites.
    tiebreak: "descending",
  });
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
