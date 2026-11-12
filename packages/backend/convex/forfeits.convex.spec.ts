/// <reference types="vite/client" />

// The organizer no-show and forfeit adjudications (see CONTEXT.md "Forfeit"
// and "No-Show"): a forfeit awards the opponent the match without play, a
// no-show is a forfeit against an absent player that also drops them by
// default (the organizer can keep them in), and both players absent is a
// double match loss — zero game wins all around. In a bracket the double
// loss empties the seat: nobody advances from it, and the scheduled opponent
// is walked over (ADR 0001). Unlike byes and drop concessions, these are
// entered results, so they block a rewind.
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
  outsiderNumber,
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

test("a forfeit awards the opponent the match without dropping anyone", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);

  await organizer.mutation(api.tournaments.rounds.recordMatchForfeit, {
    matchId: match._id,
    forfeitedRegistrationId: registrationIds[0],
    note: "  Deck check penalty  ",
  });

  const stored = await matchState(t, match._id);
  expect(stored.match?.matchStatus).toBe("completed");
  expect(stored.match?.currentResultKind).toBe("forfeit");
  expect(stored.match?.reportedByRegistrationId).toBeUndefined();
  expect(stored.revisions).toHaveLength(1);
  expect(stored.match?.currentResultRevisionId).toBe(stored.revisions[0]._id);
  expect(stored.revisions[0].kind).toBe("forfeit");
  expect(stored.revisions[0].actorRole).toBe("organizer");
  expect(stored.revisions[0].note).toBe("Deck check penalty");
  expect(lineFor(stored, registrationIds[0])).toMatchObject({
    outcome: "loss",
    matchPointsEarned: 0,
    gameWins: 0,
    gameLosses: 2,
    gameDraws: 0,
  });
  expect(opposingLine(stored, registrationIds[0])).toMatchObject({
    outcome: "win",
    matchPointsEarned: 3,
    gameWins: 2,
    gameLosses: 0,
    gameDraws: 0,
  });
  // The denormalized rows standings read carry the same result.
  expect(
    stored.players.find((player) => player.playerId === registrationIds[0]),
  ).toMatchObject({ matchPointsEarned: 0, gameWins: 0, gameLosses: 2 });

  // A forfeit is not a drop: the player stays in the tournament.
  expect(await participationOf(t, registrationIds[0])).toBe("active");

  const forfeited = await auditEventsOfType(t, tournamentId, "match_forfeited");
  expect(forfeited).toHaveLength(1);
  expect(forfeited[0].actorRole).toBe("organizer");
  if (forfeited[0].event.type !== "match_forfeited") {
    throw new Error("Expected a match_forfeited event");
  }
  expect(forfeited[0].event.player.registrationId).toBe(registrationIds[0]);
  expect(forfeited[0].event.player.playerName).toBe("Player 1");
  expect(forfeited[0].event.roundNumber).toBe(1);
  expect(forfeited[0].event.previousResult).toBeNull();
  expect(await auditEventsOfType(t, tournamentId, "player_dropped")).toEqual(
    [],
  );

  // An entered adjudication touches the round: no rewind.
  await expect(
    organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
      tournamentId,
    }),
  ).rejects.toThrow(
    "Pairings cannot be unpublished after a match result has been recorded",
  );
});

test("a forfeit follows the phase's match structure", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 3,
      bestOf: 5,
    },
  ]);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.recordMatchForfeit, {
      matchId: match._id,
      forfeitedRegistrationId: registrationIds[0],
    });

  const stored = await matchState(t, match._id);
  expect(opposingLine(stored, registrationIds[0])).toMatchObject({
    gameWins: 3,
    gameLosses: 0,
  });
  expect(lineFor(stored, registrationIds[0])).toMatchObject({
    gameWins: 0,
    gameLosses: 3,
  });
});

test("a single no-show forfeits the absent player and drops them by default", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[1]);

  await organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
    matchId: match._id,
    absentRegistrationIds: [registrationIds[1]],
  });

  const stored = await matchState(t, match._id);
  expect(stored.match?.currentResultKind).toBe("no_show");
  expect(stored.revisions).toHaveLength(1);
  expect(stored.revisions[0].kind).toBe("no_show");
  expect(lineFor(stored, registrationIds[1])).toMatchObject({
    outcome: "loss",
    gameWins: 0,
    gameLosses: 2,
  });
  expect(opposingLine(stored, registrationIds[1])).toMatchObject({
    outcome: "win",
    matchPointsEarned: 3,
    gameWins: 2,
  });
  expect(await participationOf(t, registrationIds[1])).toBe("dropped");

  // The no-show is the result; the drop it carries concedes nothing on top,
  // and the journal reads causally: the no-show, then the drop.
  const journal = await auditEvents(t, tournamentId);
  expect(journal.filter((row) => row.event.type === "match_conceded")).toEqual(
    [],
  );
  const noShow = journal.find((row) => row.event.type === "match_no_show");
  const drop = journal.find((row) => row.event.type === "player_dropped");
  if (noShow?.event.type !== "match_no_show" || !drop) {
    throw new Error("Expected a match_no_show and a player_dropped event");
  }
  expect(noShow.event.players.map((player) => player.registrationId)).toEqual([
    registrationIds[1],
  ]);
  expect(drop.actorRole).toBe("organizer");
  expect(noShow._creationTime).toBeLessThan(drop._creationTime);
});

test("keepInTournament records the no-show without dropping", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[1]);

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.recordMatchNoShow, {
      matchId: match._id,
      absentRegistrationIds: [registrationIds[1]],
      keepInTournament: true,
    });

  expect(await participationOf(t, registrationIds[1])).toBe("active");
  expect((await matchState(t, match._id)).match?.currentResultKind).toBe(
    "no_show",
  );
  expect(await auditEventsOfType(t, tournamentId, "player_dropped")).toEqual(
    [],
  );
});

test("a no-show over a drop's concession does not drop the player twice", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.dropSelf, { tournamentId });

  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.recordMatchNoShow, {
      matchId: match._id,
      absentRegistrationIds: [registrationIds[0]],
    });

  const stored = await matchState(t, match._id);
  expect(stored.revisions).toHaveLength(2);
  expect(stored.match?.currentResultKind).toBe("no_show");
  expect(await participationOf(t, registrationIds[0])).toBe("dropped");
  expect(
    await auditEventsOfType(t, tournamentId, "player_dropped"),
  ).toHaveLength(1);
  const [noShow] = await auditEventsOfType(t, tournamentId, "match_no_show");
  if (noShow.event.type !== "match_no_show") {
    throw new Error("Expected a match_no_show event");
  }
  expect(noShow.event.previousResult).not.toBeNull();
});

test("both players absent is a double match loss in Swiss", async () => {
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
  const opponentId = registrationIds[opponent - 1];

  await organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
    matchId: match._id,
    absentRegistrationIds: [registrationIds[0], opponentId],
  });

  // Zero game wins all around, both outcomes are losses, and neither side
  // earns match points — a 0–0 match that is not a draw.
  const stored = await matchState(t, match._id);
  expect(stored.revisions[0].kind).toBe("no_show");
  expect(stored.revisions[0].lines).toHaveLength(2);
  for (const line of stored.revisions[0].lines) {
    expect(line).toMatchObject({
      outcome: "loss",
      matchPointsEarned: 0,
      gameWins: 0,
      gameLosses: 0,
      gameDraws: 0,
    });
  }
  for (const player of stored.players) {
    expect(player).toMatchObject({ matchPointsEarned: 0, gameWins: 0 });
  }
  expect(await participationOf(t, registrationIds[0])).toBe("dropped");
  expect(await participationOf(t, opponentId)).toBe("dropped");
  const [noShow] = await auditEventsOfType(t, tournamentId, "match_no_show");
  if (noShow.event.type !== "match_no_show") {
    throw new Error("Expected a match_no_show event");
  }
  expect(noShow.event.players).toHaveLength(2);
  expect(
    await auditEventsOfType(t, tournamentId, "player_dropped"),
  ).toHaveLength(2);

  // The round still completes into standings, where each double-loss player
  // carries a match loss rather than a draw.
  const round = await organizer.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round!._id },
  );
  const otherMatch = pairings.find(
    ({ match: candidate }) => candidate._id !== match._id,
  );
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: otherMatch!.match._id,
    playerOneRegistrationId: otherMatch!.players[0].playerId,
    playerTwoRegistrationId: otherMatch!.players[1].playerId,
    playerOneGameWins: 2,
    playerTwoGameWins: 0,
  });
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: round!._id,
  });
  const standings = await organizer.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: round!._id },
  );
  const doubleLossRows = standings.filter(
    ({ standing }) =>
      standing.playerId === registrationIds[0] ||
      standing.playerId === opponentId,
  );
  expect(doubleLossRows).toHaveLength(2);
  for (const { standing } of doubleLossRows) {
    expect(standing.matchPoints).toBe(0);
    expect(standing.matchLosses).toBe(1);
    expect(standing.matchDraws).toBe(0);
  }
});

test("a later-round double loss feeds standings as a loss, not a draw", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);
  await playOutCurrentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const [absentMatch] = await currentPairings(t, tournamentId);
  const absentIds = absentMatch.players.map((player) => player.playerId);
  await organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
    matchId: absentMatch.match._id,
    absentRegistrationIds: absentIds,
    keepInTournament: true,
  });
  const { round } = await playOutCurrentRound(t, tournamentId);

  // The incremental standings agree with a full recompute from match
  // history, tiebreakers and rank order included.
  await expectStandingsMatchOracle(t, tournamentId, round._id, 2, {
    assertRankOrder: true,
  });
  const standings = await organizer.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: round._id },
  );
  expect(standings).toHaveLength(registrationIds.length);
  for (const { standing } of standings) {
    if (!absentIds.includes(standing.playerId)) {
      continue;
    }
    // Two rounds on record: round one's result plus a loss with no games in
    // it, and the other absent player counted as an opponent faced.
    expect(standing.matchWins + standing.matchLosses).toBe(2);
    expect(standing.matchDraws).toBe(0);
    expect(standing.matchLosses).toBeGreaterThanOrEqual(1);
    expect(standing.gameDraws).toBe(0);
    expect((standing.gameWins ?? 0) + (standing.gameLosses ?? 0)).toBe(2);
    expect(standing.opponentIds).toHaveLength(2);
    expect(standing.opponentIds).toContain(
      absentIds.find((id) => id !== standing.playerId),
    );
  }
});

test("a bracket double no-show empties the seat and walks the opponent over", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedStartedTournament(t, 4, BRACKET_ONLY);
  const organizer = t.withIdentity(organizerIdentity);
  const semifinals = await currentPairings(t, tournamentId);
  expect(semifinals).toHaveLength(2);
  const [absentSemifinal, playedSemifinal] = semifinals;
  const absentIds = absentSemifinal.players.map((player) => player.playerId);

  // One absent player stays in the tournament and one is dropped by the
  // default: either way neither holds a bracket seat afterwards.
  await organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
    matchId: absentSemifinal.match._id,
    absentRegistrationIds: absentIds,
    keepInTournament: true,
  });
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: absentIds[1],
  });
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: playedSemifinal.match._id,
    playerOneRegistrationId: playedSemifinal.players[0].playerId,
    playerTwoRegistrationId: playedSemifinal.players[1].playerId,
    playerOneGameWins: 2,
    playerTwoGameWins: 1,
  });
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: absentSemifinal.match.tournamentRoundId,
  });

  expect(await participationOf(t, absentIds[0])).toBe("eliminated");
  expect(await participationOf(t, absentIds[1])).toBe("dropped");

  // The finals seat the double loss emptied has no holder: the played
  // semifinal's winner takes the final as a walkover.
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const finals = await currentPairings(t, tournamentId);
  expect(finals).toHaveLength(1);
  expect(finals[0].players).toHaveLength(1);
  expect(finals[0].players[0]).toMatchObject({
    playerId: playedSemifinal.players[0].playerId,
    isBye: true,
  });
  expect(finals[0].match.currentResultKind).toBe("bye");
});

test("empty seat pairs keep every later bracket seat in its own half", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedStartedTournament(t, 16, BRACKET_ONLY);
  const organizer = t.withIdentity(organizerIdentity);
  const roundOf16 = await currentBracket(t, tournamentId);
  expect(roundOf16.map(({ match }) => match.bracketSeat)).toEqual([
    1, 2, 3, 4, 5, 6, 7, 8,
  ]);
  // Seats 1 and 2 feed the same quarterfinal: with both a double no-show,
  // that quarterfinal has nobody to play it.
  for (const emptied of roundOf16.slice(0, 2)) {
    await organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
      matchId: emptied.match._id,
      absentRegistrationIds: emptied.players.map((player) => player.playerId),
    });
  }
  // playOutCurrentRound awards every open match to its first-listed player.
  const firstListed = (pairing: (typeof roundOf16)[number]) =>
    pairing.players[0].playerId;
  await playOutCurrentRound(t, tournamentId);

  // No match is created for the empty quarterfinal, and the other three
  // keep their own positions instead of sliding up into it.
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const quarterfinals = await currentBracket(t, tournamentId);
  expect(quarterfinals.map(({ match }) => match.bracketSeat)).toEqual([
    2, 3, 4,
  ]);
  expect(quarterfinals[0].players.map((player) => player.playerId)).toEqual(
    expect.arrayContaining([
      firstListed(roundOf16[2]),
      firstListed(roundOf16[3]),
    ]),
  );
  await playOutCurrentRound(t, tournamentId);

  // The top half's surviving quarterfinal winner is walked over by the
  // empty seat; the bottom half plays its own semifinal.
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const semifinals = await currentBracket(t, tournamentId);
  expect(semifinals.map(({ match }) => match.bracketSeat)).toEqual([1, 2]);
  expect(semifinals[0].players).toHaveLength(1);
  expect(semifinals[0].players[0]).toMatchObject({
    playerId: firstListed(quarterfinals[0]),
    isBye: true,
  });
  expect(semifinals[1].players.map((player) => player.playerId).sort()).toEqual(
    [firstListed(quarterfinals[1]), firstListed(quarterfinals[2])].sort(),
  );
});

test("a rewind reopens a bracket double no-show for correction", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedStartedTournament(t, 4, BRACKET_ONLY);
  const organizer = t.withIdentity(organizerIdentity);
  const [absentSemifinal, playedSemifinal] = await currentPairings(
    t,
    tournamentId,
  );
  const absentIds = absentSemifinal.players.map((player) => player.playerId);
  await organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
    matchId: absentSemifinal.match._id,
    absentRegistrationIds: absentIds,
  });
  await playOutCurrentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  // The final is a walkover: an automatic result, so it does not hold the
  // rewind back.
  expect((await currentPairings(t, tournamentId))[0].players).toHaveLength(1);
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });

  // The players the no-show dropped were found after all: reinstated, and
  // their match gets the result they played.
  for (const registrationId of absentIds) {
    expect(await participationOf(t, registrationId)).toBe("dropped");
    await organizer.mutation(
      api.tournaments.registrations.reinstateRegistration,
      { registrationId },
    );
    expect(await participationOf(t, registrationId)).toBe("active");
  }
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: absentSemifinal.match._id,
    playerOneRegistrationId: absentIds[0],
    playerTwoRegistrationId: absentIds[1],
    playerOneGameWins: 2,
    playerTwoGameWins: 1,
  });
  expect(
    (await matchState(t, absentSemifinal.match._id)).match?.currentResultKind,
  ).toBe("played");
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: absentSemifinal.match.tournamentRoundId,
  });
  expect(await participationOf(t, absentIds[0])).toBe("active");
  expect(await participationOf(t, absentIds[1])).toBe("eliminated");

  // With a winner on the seat again, the final is contested.
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const [final] = await currentPairings(t, tournamentId);
  expect(final.players.map((player) => player.playerId).sort()).toEqual(
    [absentIds[0], playedSemifinal.players[0].playerId].sort(),
  );
});

test("a double no-show in the final ends the bracket with no winner", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(
    t,
    2,
    BRACKET_ONLY,
  );
  const organizer = t.withIdentity(organizerIdentity);
  const [final] = await currentPairings(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
    matchId: final.match._id,
    absentRegistrationIds: registrationIds,
    keepInTournament: true,
  });
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: final.match.tournamentRoundId,
  });

  const standings = await organizer.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: final.match.tournamentRoundId },
  );
  expect(standings).toHaveLength(2);
  for (const { standing, registrationStatus } of standings) {
    expect(standing.playoffStatus).toBe("eliminated");
    expect(registrationStatus).toBe("eliminated");
  }
  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toEqual({
    kind: "completeTournament",
    ready: true,
    reason: null,
  });
  await organizer.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });
});

test("a bracket where every seat was a double no-show offers completion", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedStartedTournament(t, 4, BRACKET_ONLY);
  const organizer = t.withIdentity(organizerIdentity);
  const semifinals = await currentPairings(t, tournamentId);
  for (const semifinal of semifinals) {
    await organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
      matchId: semifinal.match._id,
      absentRegistrationIds: semifinal.players.map((player) => player.playerId),
    });
  }
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: semifinals[0].match.tournamentRoundId,
  });

  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toEqual({
    kind: "completeTournament",
    ready: true,
    reason: null,
  });
  await expect(
    organizer.mutation(api.tournaments.rounds.generateNextRound, {
      tournamentId,
    }),
  ).rejects.toThrow("Every remaining bracket player has left the tournament");
  await organizer.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });
});

test("adjudications validate their players and replace results transparently", async () => {
  const t = createConvexTest();
  // Five players: the lowest seed (player 5) takes the round-one bye.
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 5);
  const organizer = t.withIdentity(organizerIdentity);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);
  const byeMatch = await matchForPlayer(t, tournamentId, 1, registrationIds[4]);
  const outsiderId =
    registrationIds[(await outsiderNumber(t, match._id, registrationIds)) - 1];

  // Wrong-player and bye refusals are things no client sends: plain errors,
  // generic in production.
  for (const refused of [
    organizer.mutation(api.tournaments.rounds.recordMatchForfeit, {
      matchId: match._id,
      forfeitedRegistrationId: outsiderId,
    }),
    organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
      matchId: match._id,
      absentRegistrationIds: [outsiderId],
    }),
    organizer.mutation(api.tournaments.rounds.recordMatchForfeit, {
      matchId: byeMatch._id,
      forfeitedRegistrationId: registrationIds[4],
    }),
  ]) {
    const error = await rejection(refused);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UserError);
  }
  const empty = await rejection(
    organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
      matchId: match._id,
      absentRegistrationIds: [],
    }),
  );
  expect(empty).toBeInstanceOf(UserError);
  expect((empty as Error).message).toBe(
    "A no-show names one or both players of the match",
  );
  await expect(
    organizer.mutation(api.tournaments.rounds.recordMatchForfeit, {
      matchId: match._id,
      forfeitedRegistrationId: registrationIds[0],
      note: "x".repeat(501),
    }),
  ).rejects.toThrow("Result note must be at most 500 characters");
  expect((await matchState(t, match._id)).revisions).toHaveLength(0);

  // Replacing a recorded result preserves it in the audit event, like any
  // organizer override — and an ordinary result replaces a forfeit in turn.
  const opponent = await opponentNumber(
    t,
    match._id,
    registrationIds[0],
    registrationIds,
  );
  const resultArgs = {
    matchId: match._id,
    playerOneRegistrationId: registrationIds[0],
    playerTwoRegistrationId: registrationIds[opponent - 1],
    playerOneGameWins: 2,
    playerTwoGameWins: 1,
  };
  await organizer.mutation(
    api.tournaments.rounds.recordMatchResult,
    resultArgs,
  );
  await organizer.mutation(api.tournaments.rounds.recordMatchForfeit, {
    matchId: match._id,
    forfeitedRegistrationId: registrationIds[0],
  });
  let stored = await matchState(t, match._id);
  expect(stored.revisions).toHaveLength(2);
  expect(stored.match?.currentResultKind).toBe("forfeit");
  const forfeited = await auditEventsOfType(t, tournamentId, "match_forfeited");
  if (forfeited[0].event.type !== "match_forfeited") {
    throw new Error("Expected a match_forfeited event");
  }
  expect(
    forfeited[0].event.previousResult?.find(
      (line) => line.registrationId === registrationIds[0],
    ),
  ).toMatchObject({ gameWins: 2, gameLosses: 1 });

  await organizer.mutation(
    api.tournaments.rounds.recordMatchResult,
    resultArgs,
  );
  stored = await matchState(t, match._id);
  expect(stored.revisions).toHaveLength(3);
  expect(stored.match?.currentResultKind).toBe("played");
});

test("adjudications need organizer access and an active round", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedStartedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);
  const match = await matchForPlayer(t, tournamentId, 1, registrationIds[0]);

  // A player of the match is not an organizer of the event.
  const player = t.withIdentity(playerIdentity(1));
  await expect(
    player.mutation(api.tournaments.rounds.recordMatchForfeit, {
      matchId: match._id,
      forfeitedRegistrationId: registrationIds[1],
    }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    player.mutation(api.tournaments.rounds.recordMatchNoShow, {
      matchId: match._id,
      absentRegistrationIds: [registrationIds[1]],
    }),
  ).rejects.toThrow("Unauthorized");
  expect((await matchState(t, match._id)).revisions).toHaveLength(0);

  // Once the round is completed its results stand (CONTEXT.md "Rewind").
  const pairings = await currentPairings(t, tournamentId);
  for (const pairing of pairings) {
    await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: pairing.match._id,
      playerOneRegistrationId: pairing.players[0].playerId,
      playerTwoRegistrationId: pairing.players[1].playerId,
      playerOneGameWins: 2,
      playerTwoGameWins: 0,
    });
  }
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: match.tournamentRoundId,
  });
  const refused = await rejection(
    organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
      matchId: match._id,
      absentRegistrationIds: [registrationIds[0]],
    }),
  );
  expect(refused).toBeInstanceOf(UserError);
  expect((refused as Error).message).toBe(
    "Match results can only be recorded during an active round",
  );
  expect(await participationOf(t, registrationIds[0])).toBe("active");
});

test("a cancelled tournament takes no more results, though its round stays open", async () => {
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
  await organizer.mutation(api.tournaments.lifecycle.cancelTournament, {
    tournamentId,
  });

  for (const refused of [
    organizer.mutation(api.tournaments.rounds.recordMatchForfeit, {
      matchId: match._id,
      forfeitedRegistrationId: registrationIds[0],
    }),
    // Kept in or dropped, the refusal is the same one.
    organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
      matchId: match._id,
      absentRegistrationIds: [registrationIds[0]],
      keepInTournament: true,
    }),
    organizer.mutation(api.tournaments.rounds.recordMatchNoShow, {
      matchId: match._id,
      absentRegistrationIds: [registrationIds[0]],
    }),
    organizer.mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: match._id,
      playerOneRegistrationId: registrationIds[0],
      playerTwoRegistrationId: registrationIds[opponent - 1],
      playerOneGameWins: 2,
      playerTwoGameWins: 0,
    }),
  ]) {
    const error = await rejection(refused);
    expect(error).toBeInstanceOf(UserError);
    expect((error as Error).message).toBe(
      "Match results can only be recorded during an active round",
    );
  }
  expect((await matchState(t, match._id)).revisions).toHaveLength(0);
});

async function seedStartedTournament(
  t: TestConvex<typeof schema>,
  playerCount: number,
  phases?: Parameters<typeof seedTournamentWithPlayers>[1]["phases"],
) {
  const seeded = await seedTournamentWithPlayers(t, {
    name: "Adjudication Event",
    playerCount,
    phases,
    // Descending so equal records rank in player-number order, keeping the
    // round-one bye on the highest player number.
    tiebreak: "descending",
  });
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.startTournament, {
      tournamentId: seeded.tournamentId,
    });
  return seeded;
}

// The current round's pairings as the organizer's board lists them.
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

// The current bracket round's pairings in seat order.
async function currentBracket(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  return (await currentPairings(t, tournamentId)).sort(
    (left, right) =>
      (left.match.bracketSeat ?? 0) - (right.match.bracketSeat ?? 0),
  );
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

type MatchState = Awaited<ReturnType<typeof matchState>>;

// The current (latest) revision's line for a player, and for their opponent.
function lineFor(
  stored: MatchState,
  registrationId: Id<"tournamentRegistrations">,
) {
  return stored.revisions
    .at(-1)
    ?.lines.find((line) => line.registrationId === registrationId);
}

function opposingLine(
  stored: MatchState,
  registrationId: Id<"tournamentRegistrations">,
) {
  return stored.revisions
    .at(-1)
    ?.lines.find((line) => line.registrationId !== registrationId);
}

async function participationOf(
  t: TestConvex<typeof schema>,
  registrationId: Id<"tournamentRegistrations">,
) {
  return await t.run(
    async (ctx) => (await ctx.db.get(registrationId))?.participationStatus,
  );
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

async function auditEventsOfType(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
  type: string,
) {
  return (await auditEvents(t, tournamentId)).filter(
    (row) => row.event.type === type,
  );
}
