/// <reference types="vite/client" />

import { expect, test } from "vitest";

import { api } from "./_generated/api";
import {
  matchForPlayer,
  opponentNumber,
  organizerIdentity,
  playOutCurrentRound,
  playerIdentity,
  seedTournamentWithPlayers,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

// The organizer overview's live band reads result progress and the field's
// participation counts off the pairings board. Five players pair to two
// tables and a bye, which exercises every counter at once.
test("the board carries live round result progress and field counts", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournamentWithPlayers(t, {
    name: "Overview counts",
    playerCount: 5,
    tiebreak: "descending",
  });
  const organizer = t.withIdentity(organizerIdentity);

  // Before play there is no live round to summarize.
  let board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.liveRound).toBeNull();
  expect(board.field).toEqual({
    confirmed: 5,
    active: 5,
    dropped: 0,
    eliminated: 0,
    disqualified: 0,
  });

  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.liveRound).toMatchObject({
    roundNumber: 1,
    tableCount: 2,
    byeCount: 1,
    resultsIn: 0,
    unconfirmedCount: 0,
  });

  // A player's own report counts toward completion but stays unconfirmed.
  const playerOneMatch = await matchForPlayer(
    t,
    tournamentId,
    1,
    registrationIds[0],
  );
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.player.reportMyMatchResult, {
      matchId: playerOneMatch._id,
      myGameWins: 2,
      opponentGameWins: 1,
    });
  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.liveRound).toMatchObject({
    tableCount: 2,
    resultsIn: 1,
    unconfirmedCount: 1,
  });
  // The unconfirmed report still counts: one table remains, so the round
  // cannot complete yet (the timer being the next offered step).
  expect(board.nextStep).toMatchObject({ kind: "startTimer", ready: true });

  // The organizer overriding it clears the unconfirmed flag.
  const opponent = await opponentNumber(
    t,
    playerOneMatch._id,
    registrationIds[0],
    registrationIds,
  );
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: playerOneMatch._id,
    playerOneRegistrationId: registrationIds[0],
    playerTwoRegistrationId: registrationIds[opponent - 1],
    playerOneGameWins: 2,
    playerTwoGameWins: 0,
  });
  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.liveRound).toMatchObject({ resultsIn: 1, unconfirmedCount: 0 });

  // A drop moves one player out of the active count.
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: registrationIds[4],
  });
  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.field).toMatchObject({ confirmed: 5, active: 4, dropped: 1 });

  // Between rounds there is nothing live to count.
  await playOutCurrentRound(t, tournamentId);
  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.liveRound).toBeNull();
});

// The field counts come off the tournament row's stored tally, so every path
// that changes a player's participation has to move it: a drop, a reinstate,
// a cut's eliminations, and the rewind that undoes them.
test("the field counts follow drops, reinstates, a cut, and its rewind", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournamentWithPlayers(t, {
    name: "Overview field tally",
    playerCount: 5,
    tiebreak: "descending",
    phases: [
      {
        phaseOrder: 1,
        phaseRoundMode: "fixed",
        phaseTotalRounds: 1,
        phaseCutoff: { kind: "top_X_players", playerCount: 3 },
      },
      { phaseOrder: 2, phaseRoundMode: "fixed", phaseTotalRounds: 1 },
    ],
  });
  const organizer = t.withIdentity(organizerIdentity);
  const field = async () =>
    (
      await organizer.query(api.tournaments.rounds.getPairingsBoard, {
        tournamentId,
      })
    ).field;

  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: registrationIds[4],
  });
  expect(await field()).toMatchObject({ confirmed: 5, active: 4, dropped: 1 });

  // A reinstate before any elimination returns the player to active play.
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    { registrationId: registrationIds[4] },
  );
  expect(await field()).toMatchObject({ confirmed: 5, active: 5, dropped: 0 });

  // The cut to three eliminates the other two when the bracket is paired.
  await playOutCurrentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  expect(await field()).toEqual({
    confirmed: 5,
    active: 3,
    dropped: 0,
    eliminated: 2,
    disqualified: 0,
  });

  // Rewinding the bracket's first round undoes the cut's eliminations.
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  expect(await field()).toMatchObject({ active: 5, eliminated: 0 });
});
