/// <reference types="vite/client" />

import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  organizerIdentity,
  playOutCurrentRound,
  seedOrganizer,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

function playerIdentity(playerNumber: number) {
  return {
    issuer: "https://convex.test",
    subject: `player-${playerNumber}`,
    tokenIdentifier: `https://convex.test|player-${playerNumber}`,
    email: `player${playerNumber}@example.test`,
    name: `Player ${playerNumber}`,
  };
}

test("phase-1 meeting walks startPlayerMeeting -> startTournament -> completed", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, 4, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 3,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);

  let board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  const phaseId = board.phases[0].phase._id;
  expect(board.nextStep).toMatchObject({
    kind: "startPlayerMeeting",
    ready: true,
    phaseId,
  });

  await expect(
    organizer.mutation(api.tournaments.rounds.startTournament, {
      tournamentId,
    }),
  ).rejects.toThrow("Player meeting must be started first");

  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId,
  });
  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.phases[0].phase.playerMeetingStatus).toBe("in_progress");
  expect(board.nextStep).toMatchObject({
    kind: "startTournament",
    ready: true,
  });

  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.phases[0].phase.playerMeetingStatus).toBe("completed");
  // The meeting is a phantom round: exactly one real round exists after start.
  expect(board.phases[0].rounds).toHaveLength(1);
});

test("seats players alphabetically two per table, odd player alone at the end", async () => {
  const t = createConvexTest();
  const names = ["charlie", "Alice", "bob", "Dave", "eve"];
  const { tournamentId } = await seedTournament(
    t,
    names.length,
    [{ phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true }],
    names,
  );
  const organizer = t.withIdentity(organizerIdentity);
  const phaseId = await firstPhaseId(t, tournamentId);

  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId,
  });
  const seating = await organizer.query(
    api.tournaments.playerMeeting.listPlayerMeetingSeats,
    { phaseId },
  );
  expect(seating.meetingStatus).toBe("in_progress");
  expect(seating.seats.map((seat) => seat.playerName)).toEqual([
    "Alice",
    "bob",
    "charlie",
    "Dave",
    "eve",
  ]);
  expect(seating.seats.map((seat) => seat.tableNumber)).toEqual([
    1, 1, 2, 2, 3,
  ]);
  expect(
    seating.seats.every((seat) => seat.registrationStatus === "active"),
  ).toBe(true);
});

test("startPlayerMeeting rejects bad states", async () => {
  // Each scenario gets its own backend: the seed helpers insert the organizer
  // fixture, which must exist exactly once per instance.

  // Not enabled on the phase.
  {
    const t = createConvexTest();
    const { tournamentId } = await seedTournament(t, 4);
    const phaseId = await firstPhaseId(t, tournamentId);
    await expect(
      t
        .withIdentity(organizerIdentity)
        .mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
          phaseId,
        }),
    ).rejects.toThrow("Player meeting is not enabled for this phase");
  }

  // Already started.
  {
    const t = createConvexTest();
    const { tournamentId } = await seedTournament(t, 4, [
      { phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true },
    ]);
    const organizer = t.withIdentity(organizerIdentity);
    const phaseId = await firstPhaseId(t, tournamentId);
    await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
      phaseId,
    });
    await expect(
      organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
        phaseId,
      }),
    ).rejects.toThrow("Player meeting has already started");
  }

  // Too few active players.
  {
    const t = createConvexTest();
    const { tournamentId } = await seedTournament(t, 1, [
      { phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true },
    ]);
    const organizer = t.withIdentity(organizerIdentity);
    const phaseId = await firstPhaseId(t, tournamentId);
    const board = await organizer.query(
      api.tournaments.rounds.getPairingsBoard,
      { tournamentId },
    );
    expect(board.nextStep).toMatchObject({
      kind: "startPlayerMeeting",
      ready: false,
      reason: "At least two active players are required",
    });
    await expect(
      organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
        phaseId,
      }),
    ).rejects.toThrow("At least two active players are required");
  }

  // Cancelled tournament.
  {
    const t = createConvexTest();
    const { tournamentId } = await seedTournament(t, 4, [
      { phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true },
    ]);
    const organizer = t.withIdentity(organizerIdentity);
    const phaseId = await firstPhaseId(t, tournamentId);
    await organizer.mutation(api.tournaments.lifecycle.cancelTournament, {
      tournamentId,
    });
    await expect(
      organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
        phaseId,
      }),
    ).rejects.toThrow("Tournament is no longer running");
  }
});

test("drops during the meeting strike the seat, keep it on reinstate, and shrink round 1", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournament(t, 4, [
    { phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  const phaseId = await firstPhaseId(t, tournamentId);
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId,
  });

  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: registrationIds[3],
  });
  let seating = await organizer.query(
    api.tournaments.playerMeeting.listPlayerMeetingSeats,
    { phaseId },
  );
  expect(seating.seats).toHaveLength(4);
  const droppedSeat = seating.seats.find(
    (seat) => seat.registrationId === registrationIds[3],
  );
  expect(droppedSeat?.registrationStatus).toBe("cancelled");
  const droppedTable = droppedSeat?.tableNumber;

  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    {
      registrationId: registrationIds[3],
    },
  );
  seating = await organizer.query(
    api.tournaments.playerMeeting.listPlayerMeetingSeats,
    { phaseId },
  );
  const reinstatedSeat = seating.seats.find(
    (seat) => seat.registrationId === registrationIds[3],
  );
  expect(reinstatedSeat?.registrationStatus).toBe("active");
  expect(reinstatedSeat?.tableNumber).toBe(droppedTable);

  // Drop again; the no-show must not be paired into round 1.
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: registrationIds[3],
  });
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const roundOnePlayerIds = await t.run(async (ctx) => {
    const phase = await ctx.db.get(phaseId);
    const round = await ctx.db.get(phase!.phaseCurrentRound!);
    const matches = await ctx.db
      .query("tournamentMatches")
      .withIndex("by_tournamentRoundId", (q) =>
        q.eq("tournamentRoundId", round!._id),
      )
      .take(16);
    const playerIds: Id<"tournamentRegistrations">[] = [];
    for (const match of matches) {
      const players = await ctx.db
        .query("tournamentMatchPlayers")
        .withIndex("by_tournamentMatchId_and_playerId", (q) =>
          q.eq("tournamentMatchId", match._id),
        )
        .take(2);
      playerIds.push(...players.map((player) => player.playerId));
    }
    return playerIds;
  });
  expect(roundOnePlayerIds).toHaveLength(3);
  expect(roundOnePlayerIds).not.toContain(registrationIds[3]);
});

test("a seat's registrationStatus distinguishes a deleted registration from a malformed one", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournament(t, 4, [
    { phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  const phaseId = await firstPhaseId(t, tournamentId);
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId,
  });

  // A malformed row: confirmed with no participationStatus recorded. Every
  // real write path pairs the two (see setRegistrationState), so this can
  // only happen if the row is corrupt.
  await t.run(async (ctx) => {
    await ctx.db.patch(registrationIds[0], { participationStatus: undefined });
  });
  // A registration that no longer exists at all.
  await t.run(async (ctx) => {
    await ctx.db.delete(registrationIds[1]);
  });

  const seating = await organizer.query(
    api.tournaments.playerMeeting.listPlayerMeetingSeats,
    { phaseId },
  );
  const malformedSeat = seating.seats.find(
    (seat) => seat.registrationId === registrationIds[0],
  );
  const deletedSeat = seating.seats.find(
    (seat) => seat.registrationId === registrationIds[1],
  );
  expect(malformedSeat?.registrationStatus).toBe("unknown");
  expect(deletedSeat?.registrationStatus).toBe("removed");
  expect(malformedSeat?.registrationStatus).not.toBe(
    deletedSeat?.registrationStatus,
  );
});

test("a later phase holds its own meeting between phases", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, 4, [
    { phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 },
    {
      phaseOrder: 2,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  let board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  const phaseTwoId = board.phases[1].phase._id;
  expect(board.nextStep).toMatchObject({
    kind: "startPlayerMeeting",
    ready: true,
    phaseId: phaseTwoId,
  });

  await expect(
    organizer.mutation(api.tournaments.rounds.generateNextRound, {
      tournamentId,
    }),
  ).rejects.toThrow("Player meeting must be started first");

  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId: phaseTwoId,
  });
  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toMatchObject({
    kind: "generateNextRound",
    ready: true,
  });

  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.phases[1].phase.playerMeetingStatus).toBe("completed");
  expect(board.phases[1].phase.phaseStatus).toBe("in_progress");
  // Global round numbering continues across the meeting.
  expect(board.phases[1].rounds[0].roundNumber).toBe(2);
});

test("a cutoff meeting snapshot controls player views and the next-phase field", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournament(t, 4, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff: { kind: "top_X_players", playerCount: 3 },
    },
    {
      phaseOrder: 2,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  const phaseTwoId = board.phases[1].phase._id;
  expect(board.nextStep).toMatchObject({
    kind: "startPlayerMeeting",
    ready: true,
    phaseId: phaseTwoId,
  });

  const finalRoundId = board.phases[0].rounds[0]._id;
  const standings = await organizer.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: finalRoundId },
  );
  const qualifierIds = standings
    .slice(0, 3)
    .map(({ standing }) => standing.playerId);
  const nonQualifierId = registrationIds.find(
    (registrationId) => !qualifierIds.includes(registrationId),
  );
  if (!nonQualifierId) {
    throw new Error("Expected one player to miss the cutoff");
  }

  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId: phaseTwoId,
  });
  const seating = await organizer.query(
    api.tournaments.playerMeeting.listPlayerMeetingSeats,
    { phaseId: phaseTwoId },
  );
  expect(seating.seats).toHaveLength(3);
  expect(seating.seats.map((seat) => seat.registrationId).sort()).toEqual(
    [...qualifierIds].sort(),
  );

  // The active non-qualifier remains on the completed-round view instead of
  // being told to attend a meeting where they have no seat.
  const nonQualifierNumber = registrationIds.indexOf(nonQualifierId) + 1;
  const nonQualifierView = await t
    .withIdentity(playerIdentity(nonQualifierNumber))
    .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
  expect(nonQualifierView.kind).toBe("between_rounds");

  // Dropping a seated qualifier does not backfill the unseated player when
  // round one is paired: the meeting snapshot is the authoritative field.
  const droppedQualifierId = qualifierIds[0];
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: droppedQualifierId,
  });
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const nextRound = await organizer.query(
    api.tournaments.rounds.getCurrentRound,
    { tournamentId },
  );
  if (!nextRound) {
    throw new Error("Expected the next phase's first round");
  }
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: nextRound._id },
  );
  const pairedIds = pairings.flatMap(({ players }) =>
    players.map((player) => player.playerId),
  );
  expect(pairedIds.sort()).toEqual(
    qualifierIds
      .filter((registrationId) => registrationId !== droppedQualifierId)
      .sort(),
  );
  expect(pairedIds).not.toContain(nonQualifierId);
});

test("a cutoff meeting's seats draw the boundary for dropped-player eliminations", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, 5, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff: { kind: "top_X_players", playerCount: 3 },
    },
    {
      phaseOrder: 2,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  const phaseTwoId = board.phases[1].phase._id;
  const finalRoundId = board.phases[0].rounds[0]._id;
  const ranked = (
    await organizer.query(api.tournaments.rounds.listRoundStandings, {
      roundId: finalRoundId,
    })
  ).map(({ standing }) => standing.playerId);

  // The two top-ranked players drop before the meeting, so the seated entry
  // field is ranks 3-5.
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: ranked[0],
  });
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: ranked[1],
  });
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId: phaseTwoId,
  });
  const seating = await organizer.query(
    api.tournaments.playerMeeting.listPlayerMeetingSeats,
    { phaseId: phaseTwoId },
  );
  expect(seating.seats.map((seat) => seat.registrationId).sort()).toEqual(
    [ranked[2], ranked[3], ranked[4]].sort(),
  );

  // During the meeting the rank-1 player is reinstated (active again, but
  // unseated) and the seated rank-5 player drops.
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    { registrationId: ranked[0] },
  );
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: ranked[4],
  });
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  const registrationsById = async () =>
    new Map(
      (
        await organizer.query(
          api.tournaments.registrations.listRegistrationPage,
          { tournamentId, paginationOpts: { cursor: null, numItems: 100 } },
        )
      ).page.map(({ registration }) => [registration._id, registration]),
    );

  // Round 1 pairs exactly the seated players still active.
  const currentRound = await organizer.query(
    api.tournaments.rounds.getCurrentRound,
    { tournamentId },
  );
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: currentRound!._id },
  );
  expect(
    pairings
      .flatMap(({ players }) => players.map((player) => player.playerId))
      .sort(),
  ).toEqual([ranked[2], ranked[3]].sort());

  // The reinstated rank-1 player holds no seat, so pairing eliminates them
  // instead of backfilling.
  expect((await registrationsById()).get(ranked[0])).toMatchObject({
    participationStatus: "eliminated",
    eliminatedByRoundId: finalRoundId,
  });

  // The rank-2 player is dropped and unseated: outside the frozen entry
  // field, so the cut records their elimination even though the live
  // standings rank them above the boundary — reinstating cannot backfill
  // them either.
  expect((await registrationsById()).get(ranked[1])).toMatchObject({
    participationStatus: "dropped",
    eliminatedByRoundId: finalRoundId,
  });
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    { registrationId: ranked[1] },
  );
  expect((await registrationsById()).get(ranked[1])).toMatchObject({
    participationStatus: "eliminated",
    eliminatedByRoundId: finalRoundId,
  });

  // The seated rank-5 player made the cut; their absence is pure withdrawal,
  // with no elimination record even though the reinstated rank-1 player would
  // push them below a live-standings boundary — so reinstating returns them
  // to active play.
  const seatedDropped = (await registrationsById()).get(ranked[4]);
  expect(seatedDropped?.participationStatus).toBe("dropped");
  expect(seatedDropped?.eliminatedByRoundId).toBeUndefined();
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    { registrationId: ranked[4] },
  );
  expect((await registrationsById()).get(ranked[4])).toMatchObject({
    participationStatus: "active",
  });
});

test("a rewound next phase still cuts against its meeting seats when re-paired", async () => {
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournament(t, 5, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff: { kind: "top_X_players", playerCount: 3 },
    },
    {
      phaseOrder: 2,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  const phaseTwoId = board.phases[1].phase._id;
  const finalRoundId = board.phases[0].rounds[0]._id;

  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId: phaseTwoId,
  });
  const seatedIds = (
    await organizer.query(
      api.tournaments.playerMeeting.listPlayerMeetingSeats,
      { phaseId: phaseTwoId },
    )
  ).seats.map((seat) => seat.registrationId);
  expect(seatedIds).toHaveLength(3);
  const unseatedIds = registrationIds.filter((id) => !seatedIds.includes(id));

  // A seated player withdraws during the meeting, then the freshly paired
  // (result-free) first round of phase two is rewound.
  const droppedSeatedId = seatedIds[0];
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: droppedSeatedId,
  });
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });

  // The rewind returns phase two to "upcoming" and stamps its meeting
  // "superseded": the seats are still on disk but the standings they were
  // drawn from are gone, and the stamp is what routes the re-drawn cut.
  const rewoundPhaseTwo = await t.run(async (ctx) => ctx.db.get(phaseTwoId));
  expect(rewoundPhaseTwo?.phaseStatus).toBe("upcoming");
  expect(rewoundPhaseTwo?.playerMeetingStatus).toBe("superseded");

  await playOutCurrentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  // Re-pairing consumed the superseded snapshot and re-completed the meeting.
  const repairedPhaseTwo = await t.run(async (ctx) => ctx.db.get(phaseTwoId));
  expect(repairedPhaseTwo?.phaseStatus).toBe("in_progress");
  expect(repairedPhaseTwo?.playerMeetingStatus).toBe("completed");

  const repairedRound = await organizer.query(
    api.tournaments.rounds.getCurrentRound,
    { tournamentId },
  );
  const repairedIds = (
    await organizer.query(api.tournaments.rounds.listRoundPairings, {
      roundId: repairedRound!._id,
    })
  ).flatMap(({ players }) => players.map((player) => player.playerId));
  // Only the still-active seated players enter: no unseated player is
  // backfilled into the seat the withdrawal left behind.
  expect(repairedIds.sort()).toEqual(
    seatedIds.filter((id) => id !== droppedSeatedId).sort(),
  );
  for (const unseatedId of unseatedIds) {
    expect(repairedIds).not.toContain(unseatedId);
  }

  const registrationsById = new Map(
    (
      await organizer.query(
        api.tournaments.registrations.listRegistrationPage,
        {
          tournamentId,
          paginationOpts: { cursor: null, numItems: 100 },
        },
      )
    ).page.map(({ registration }) => [registration._id, registration]),
  );
  // The withdrawn player held a seat, so the re-run cut leaves them unstamped
  // and reinstating still returns them to play.
  expect(registrationsById.get(droppedSeatedId)?.participationStatus).toBe(
    "dropped",
  );
  expect(
    registrationsById.get(droppedSeatedId)?.eliminatedByRoundId,
  ).toBeUndefined();
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    { registrationId: droppedSeatedId },
  );
  const reinstated = await t.run(
    async (ctx) => await ctx.db.get(droppedSeatedId),
  );
  expect(reinstated?.participationStatus).toBe("active");
  // The unseated players are still cut, stamped by the phase-one final round.
  for (const unseatedId of unseatedIds) {
    expect(registrationsById.get(unseatedId)).toMatchObject({
      participationStatus: "eliminated",
      eliminatedByRoundId: finalRoundId,
    });
  }
});

// The superseded-snapshot cut is routed by the explicit "superseded" stamp the
// rewind writes, not inferred from a "completed" meeting on an "upcoming"
// phase. A next phase carrying "completed" while still upcoming violates the
// state machine (pairing stamps "completed" only in the patch that starts the
// phase; the rewind re-stamps "superseded"), and the cut must refuse it loudly
// instead of silently re-drawing the boundary against standings the seats may
// never have been drawn from.
test("an upcoming next phase with a 'completed' meeting fails the cut loudly", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, 5, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff: { kind: "top_X_players", playerCount: 3 },
    },
    {
      phaseOrder: 2,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  const phaseTwoId = board.phases[1].phase._id;
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId: phaseTwoId,
  });
  // Simulate a rogue future code path completing the meeting without pairing
  // the phase's first round.
  await t.run(async (ctx) => {
    await ctx.db.patch(phaseTwoId, { playerMeetingStatus: "completed" });
  });

  await expect(
    organizer.mutation(api.tournaments.rounds.generateNextRound, {
      tournamentId,
    }),
  ).rejects.toThrow(
    "Next phase's player meeting is marked completed but its first round is not paired",
  );
});

// The supersede stamp is uniform: rewinding the tournament's very first round
// also marks a completed phase-1 meeting "superseded" (no cut ever reads an
// order-1 phase, but "completed" must always mean the phase's first round is
// paired), and re-starting the tournament re-completes it.
test("rewinding round 1 supersedes a phase-1 meeting; restarting re-completes it", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, 4, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 3,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  const phaseId = await firstPhaseId(t, tournamentId);
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId,
  });
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });

  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const rewound = await t.run(async (ctx) => ctx.db.get(phaseId));
  expect(rewound?.phaseStatus).toBe("upcoming");
  expect(rewound?.playerMeetingStatus).toBe("superseded");

  // The meeting already happened: the restart is offered directly, without a
  // second meeting, and pairing round 1 re-completes the snapshot.
  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toMatchObject({
    kind: "startTournament",
    ready: true,
  });
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const restarted = await t.run(async (ctx) => ctx.db.get(phaseId));
  expect(restarted?.phaseStatus).toBe("in_progress");
  expect(restarted?.playerMeetingStatus).toBe("completed");
});

// Reverses the recorded result of the first two-player match in the current
// (reopened) round and completes it again — the organizer correcting a result
// that was entered backwards, which is the documented reason to rewind.
async function correctFirstResultAndComplete(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const organizer = t.withIdentity(organizerIdentity);
  const round = await organizer.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  if (!round) {
    throw new Error("Expected the reopened round");
  }
  const pairings = await organizer.query(
    api.tournaments.rounds.listRoundPairings,
    { roundId: round._id },
  );
  const corrected = pairings.find(({ players }) => players.length === 2);
  if (!corrected) {
    throw new Error("Expected a two-player match to correct");
  }
  const [first, second] = corrected.players;
  const winner =
    (first.gameWins ?? 0) > (second.gameWins ?? 0) ? first : second;
  const loser = winner === first ? second : first;
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: corrected.match._id,
    playerOneRegistrationId: winner.playerId,
    playerTwoRegistrationId: loser.playerId,
    playerOneGameWins: 0,
    playerTwoGameWins: 2,
  });
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: round._id,
  });
  return { demotedId: winner.playerId, promotedId: loser.playerId };
}

test("a rewind that corrects a result re-draws a completed meeting's cut", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, 5, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff: { kind: "top_X_players", playerCount: 3 },
    },
    {
      phaseOrder: 2,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  const phaseTwoId = board.phases[1].phase._id;
  const finalRoundId = board.phases[0].rounds[0]._id;

  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId: phaseTwoId,
  });
  const seatedIds = (
    await organizer.query(
      api.tournaments.playerMeeting.listPlayerMeetingSeats,
      { phaseId: phaseTwoId },
    )
  ).seats.map((seat) => seat.registrationId);
  expect(seatedIds).toHaveLength(3);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  // A phase-one result was entered backwards: rewind, correct it, replay.
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const { demotedId, promotedId } = await correctFirstResultAndComplete(
    t,
    tournamentId,
  );
  // The correction swaps a seated player out for one the meeting never seated.
  expect(seatedIds).toContain(demotedId);
  expect(seatedIds).not.toContain(promotedId);

  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const repairedRound = await organizer.query(
    api.tournaments.rounds.getCurrentRound,
    { tournamentId },
  );
  const repairedIds = (
    await organizer.query(api.tournaments.rounds.listRoundPairings, {
      roundId: repairedRound!._id,
    })
  ).flatMap(({ players }) => players.map((player) => player.playerId));
  // The corrected standings decide the cut, not the stale seat snapshot.
  expect(repairedIds.sort()).toEqual(
    [...seatedIds.filter((id) => id !== demotedId), promotedId].sort(),
  );

  const registrationsById = new Map(
    (
      await organizer.query(
        api.tournaments.registrations.listRegistrationPage,
        { tournamentId, paginationOpts: { cursor: null, numItems: 100 } },
      )
    ).page.map(({ registration }) => [registration._id, registration]),
  );
  // The promoted player now legitimately made the cut: in play and unstamped.
  expect(registrationsById.get(promotedId)?.participationStatus).toBe("active");
  expect(
    registrationsById.get(promotedId)?.eliminatedByRoundId,
  ).toBeUndefined();
  // The seated player the correction dropped below the boundary is cut.
  expect(registrationsById.get(demotedId)).toMatchObject({
    participationStatus: "eliminated",
    eliminatedByRoundId: finalRoundId,
  });
});

test("a re-drawn cut still protects a seated player's withdrawal", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, 5, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff: { kind: "top_X_players", playerCount: 3 },
    },
    {
      phaseOrder: 2,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  const phaseTwoId = board.phases[1].phase._id;
  const finalRoundId = board.phases[0].rounds[0]._id;

  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId: phaseTwoId,
  });
  const seatedIds = (
    await organizer.query(
      api.tournaments.playerMeeting.listPlayerMeetingSeats,
      { phaseId: phaseTwoId },
    )
  ).seats.map((seat) => seat.registrationId);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });

  const { demotedId, promotedId } = await correctFirstResultAndComplete(
    t,
    tournamentId,
  );
  // A seated player who neither gained nor lost by the correction withdraws.
  const withdrawnSeatedId = seatedIds.find((id) => id !== demotedId)!;
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: withdrawnSeatedId,
  });
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  const repairedRound = await organizer.query(
    api.tournaments.rounds.getCurrentRound,
    { tournamentId },
  );
  const repairedIds = (
    await organizer.query(api.tournaments.rounds.listRoundPairings, {
      roundId: repairedRound!._id,
    })
  ).flatMap(({ players }) => players.map((player) => player.playerId));
  // The withdrawal's slot stays held, so the corrected cut promotes exactly one
  // player and nobody is backfilled into the vacated seat.
  expect(repairedIds.sort()).toEqual(
    [
      ...seatedIds.filter((id) => id !== demotedId && id !== withdrawnSeatedId),
      promotedId,
    ].sort(),
  );
  expect(repairedIds).not.toContain(demotedId);

  const registrationsById = async () =>
    new Map(
      (
        await organizer.query(
          api.tournaments.registrations.listRegistrationPage,
          { tournamentId, paginationOpts: { cursor: null, numItems: 100 } },
        )
      ).page.map(({ registration }) => [registration._id, registration]),
    );
  // The seated player the correction pushed below the boundary is still cut,
  // even though the withdrawal above left a place standing empty.
  expect((await registrationsById()).get(demotedId)).toMatchObject({
    participationStatus: "eliminated",
    eliminatedByRoundId: finalRoundId,
  });
  // The seated withdrawal keeps its granted entry: no elimination record, so
  // reinstating returns them to play rather than to "eliminated".
  const withdrawn = (await registrationsById()).get(withdrawnSeatedId);
  expect(withdrawn?.participationStatus).toBe("dropped");
  expect(withdrawn?.eliminatedByRoundId).toBeUndefined();
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    { registrationId: withdrawnSeatedId },
  );
  expect((await registrationsById()).get(withdrawnSeatedId)).toMatchObject({
    participationStatus: "active",
  });
});

// Drives the one ordering where a granted entry and the corrected standings
// disagree: a rewind correction pushes a SEATED player below the boundary and
// that same player then withdraws. Their seat granted an entry, but the
// standings it was drawn from are gone, so the entry no longer holds a place —
// leaving them unstamped would let a reinstate re-enter a field they no longer
// belong in. Run once per cutoff kind, because under a points bar there are no
// places to hold at all and the stamp is the only rule available.
async function reDrawCutAfterSeatedDemotionAndWithdrawal(
  t: TestConvex<typeof schema>,
  phaseCutoff:
    | { kind: "top_X_players"; playerCount: number }
    | { kind: "X_points_or_more"; matchPoints: number },
) {
  const { tournamentId } = await seedTournament(t, 5, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff,
    },
    {
      phaseOrder: 2,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  const phaseTwoId = board.phases[1].phase._id;
  const finalRoundId = board.phases[0].rounds[0]._id;

  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId: phaseTwoId,
  });
  const seatedIds = (
    await organizer.query(
      api.tournaments.playerMeeting.listPlayerMeetingSeats,
      { phaseId: phaseTwoId },
    )
  ).seats.map((seat) => seat.registrationId);
  expect(seatedIds).toHaveLength(3);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  // Rewind to correct a backwards phase-one result: it pushes a seated player
  // below the boundary and lifts an unseated one above it.
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });
  const { demotedId, promotedId } = await correctFirstResultAndComplete(
    t,
    tournamentId,
  );
  expect(seatedIds).toContain(demotedId);
  expect(seatedIds).not.toContain(promotedId);

  // The demoted seat holder ITSELF withdraws before the cut is re-drawn.
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: demotedId,
  });
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  const registrations = async () =>
    (
      await organizer.query(
        api.tournaments.registrations.listRegistrationPage,
        {
          tournamentId,
          paginationOpts: { cursor: null, numItems: 100 },
        },
      )
    ).page.map(({ registration }) => registration);
  const repairedRound = await organizer.query(
    api.tournaments.rounds.getCurrentRound,
    { tournamentId },
  );
  const repairedIds = (
    await organizer.query(api.tournaments.rounds.listRoundPairings, {
      roundId: repairedRound!._id,
    })
  ).flatMap(({ players }) => players.map((player) => player.playerId));

  return {
    organizer,
    finalRoundId,
    seatedIds,
    demotedId,
    promotedId,
    repairedIds,
    registrations,
  };
}

function confirmedActiveIds(registrations: Doc<"tournamentRegistrations">[]) {
  return registrations
    .filter(
      (registration) =>
        registration.entryStatus === "confirmed" &&
        registration.participationStatus === "active",
    )
    .map((registration) => registration._id);
}

test("a seated player demoted below a top-X boundary who withdraws is still cut", async () => {
  const t = createConvexTest();
  const {
    organizer,
    finalRoundId,
    seatedIds,
    demotedId,
    promotedId,
    repairedIds,
    registrations,
  } = await reDrawCutAfterSeatedDemotionAndWithdrawal(t, {
    kind: "top_X_players",
    playerCount: 3,
  });

  // The correction had already moved the boundary past them, so the withdrawal
  // frees its place and all three go to players who now make the cut.
  expect(repairedIds.sort()).toEqual(
    [...seatedIds.filter((id) => id !== demotedId), promotedId].sort(),
  );
  expect(repairedIds).not.toContain(demotedId);

  // Holding no place, they must carry an elimination record (the stamping
  // invariant) — otherwise reinstating them would put a fourth player into a
  // three-player field.
  const withdrawn = (await registrations()).find(
    (registration) => registration._id === demotedId,
  );
  expect(withdrawn?.participationStatus).toBe("dropped");
  expect(withdrawn?.eliminatedByRoundId).toBe(finalRoundId);

  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    { registrationId: demotedId },
  );
  const afterReinstate = await registrations();
  expect(
    afterReinstate.find((registration) => registration._id === demotedId)
      ?.participationStatus,
  ).toBe("eliminated");
  expect(confirmedActiveIds(afterReinstate).sort()).toEqual(
    [...repairedIds].sort(),
  );
});

test("a seated player demoted below a points bar who withdraws is still cut", async () => {
  const t = createConvexTest();
  const {
    organizer,
    finalRoundId,
    seatedIds,
    demotedId,
    promotedId,
    repairedIds,
    registrations,
  } = await reDrawCutAfterSeatedDemotionAndWithdrawal(t, {
    kind: "X_points_or_more",
    matchPoints: 3,
  });

  // A points bar has no places to hold, so the corrected record is the whole
  // rule: everyone still clearing the bar enters, and nobody else does.
  expect(repairedIds.sort()).toEqual(
    [...seatedIds.filter((id) => id !== demotedId), promotedId].sort(),
  );
  expect(repairedIds).not.toContain(demotedId);

  const withdrawn = (await registrations()).find(
    (registration) => registration._id === demotedId,
  );
  expect(withdrawn?.participationStatus).toBe("dropped");
  expect(withdrawn?.eliminatedByRoundId).toBe(finalRoundId);

  // Without the stamp a reinstate would return them to "active", and
  // continuePhaseWithNextRound pairs active registrations tournament-wide —
  // pairing a player whose record misses the bar into the phase they missed.
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    { registrationId: demotedId },
  );
  const afterReinstate = await registrations();
  expect(
    afterReinstate.find((registration) => registration._id === demotedId)
      ?.participationStatus,
  ).toBe("eliminated");
  expect(confirmedActiveIds(afterReinstate).sort()).toEqual(
    [...repairedIds].sort(),
  );
});

test("a cutoff meeting can complete when its seated field drops below two", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, 4, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff: { kind: "top_X_players", playerCount: 2 },
    },
    {
      phaseOrder: 2,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  let board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  const phaseTwoId = board.phases[1].phase._id;
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId: phaseTwoId,
  });
  const seating = await organizer.query(
    api.tournaments.playerMeeting.listPlayerMeetingSeats,
    { phaseId: phaseTwoId },
  );
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: seating.seats[0].registrationId,
  });

  board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toMatchObject({
    kind: "completeTournament",
    ready: true,
  });
  await organizer.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });
  const setup = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(setup.tournament.lifecycle).toBe("completed");
  expect(setup.phases.map((phase) => phase.phaseStatus)).toEqual([
    "completed",
    "cancelled",
  ]);
});

// Drives the superseded-cut analogue of the "seated field drops below two"
// dead end: a top-2 cut whose meeting was consumed by pairing, the next
// phase's first round rewound (stamping the meeting "superseded"), the final
// round re-completed with its results untouched, and then one of the two seat
// holders withdraws. The re-drawn boundary still clears them, so their granted
// entry holds a place: the partition yields one qualifier plus one held place,
// and the next phase cannot pair as it stands.
async function supersededCutWithHeldPlaceBelowTwo(
  t: TestConvex<typeof schema>,
) {
  const { tournamentId, registrationIds } = await seedTournament(t, 4, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff: { kind: "top_X_players", playerCount: 2 },
    },
    {
      phaseOrder: 2,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  const phaseTwoId = board.phases[1].phase._id;
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId: phaseTwoId,
  });
  const seatedIds = (
    await organizer.query(
      api.tournaments.playerMeeting.listPlayerMeetingSeats,
      { phaseId: phaseTwoId },
    )
  ).seats.map((seat) => seat.registrationId);
  expect(seatedIds).toHaveLength(2);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await organizer.mutation(api.tournaments.rounds.rewindLatestRound, {
    tournamentId,
  });

  // The rewind turned out to be a false alarm: re-complete the reopened final
  // round with its recorded results untouched, so the re-drawn boundary agrees
  // with the seats.
  const reopened = await organizer.query(
    api.tournaments.rounds.getCurrentRound,
    { tournamentId },
  );
  const finalRoundId = reopened!._id;
  await organizer.mutation(api.tournaments.rounds.completeRound, {
    roundId: finalRoundId,
  });
  expect(
    (await t.run(async (ctx) => ctx.db.get(phaseTwoId)))?.playerMeetingStatus,
  ).toBe("superseded");

  // One of the two seat holders withdraws. Their rank still clears the top-2
  // boundary, so the granted entry holds their place instead of freeing it.
  const withdrawnSeatedId = seatedIds[0];
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: withdrawnSeatedId,
  });

  return {
    organizer,
    tournamentId,
    registrationIds,
    seatedIds,
    withdrawnSeatedId,
    finalRoundId,
  };
}

test("a superseded cut short of two qualifiers names its recovery, and reinstating fills the held place", async () => {
  const t = createConvexTest();
  const {
    organizer,
    tournamentId,
    registrationIds,
    seatedIds,
    withdrawnSeatedId,
    finalRoundId,
  } = await supersededCutWithHeldPlaceBelowTwo(t);

  // The board never dead-ends: completing the tournament is offered from this
  // exact state (pairingsNextStep runs the same superseded partition).
  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  expect(board.nextStep).toMatchObject({
    kind: "completeTournament",
    ready: true,
  });

  // Pairing anyway refuses — and the error names the one move that makes the
  // phase playable: the withdrawn seat holder is holding a place only their
  // reinstatement can fill.
  await expect(
    organizer.mutation(api.tournaments.rounds.generateNextRound, {
      tournamentId,
    }),
  ).rejects.toThrow(
    "reinstate a dropped player who still holds a place in the field",
  );

  // The held place is real: the withdrawal is unstamped, so reinstating
  // returns them to play...
  const withdrawn = await t.run(async (ctx) => ctx.db.get(withdrawnSeatedId));
  expect(withdrawn?.participationStatus).toBe("dropped");
  expect(withdrawn?.eliminatedByRoundId).toBeUndefined();
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    { registrationId: withdrawnSeatedId },
  );

  // ...and the next phase pairs with exactly the two seat holders: the held
  // place was never backfilled while it stood empty.
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const round = await organizer.query(api.tournaments.rounds.getCurrentRound, {
    tournamentId,
  });
  const pairedIds = (
    await organizer.query(api.tournaments.rounds.listRoundPairings, {
      roundId: round!._id,
    })
  ).flatMap(({ players }) => players.map((player) => player.playerId));
  expect(pairedIds.sort()).toEqual([...seatedIds].sort());
  // The unseated players stay cut, stamped by the phase-one final round.
  for (const unseatedId of registrationIds.filter(
    (id) => !seatedIds.includes(id),
  )) {
    expect(await t.run(async (ctx) => ctx.db.get(unseatedId))).toMatchObject({
      participationStatus: "eliminated",
      eliminatedByRoundId: finalRoundId,
    });
  }
});

test("a superseded cut short of two qualifiers can complete the tournament", async () => {
  const t = createConvexTest();
  const { organizer, tournamentId } =
    await supersededCutWithHeldPlaceBelowTwo(t);

  await organizer.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });
  const setup = await organizer.query(
    api.tournaments.lifecycle.getTournamentSetup,
    { tournamentId },
  );
  expect(setup.tournament.lifecycle).toBe("completed");
  expect(setup.phases.map((phase) => phase.phaseStatus)).toEqual([
    "completed",
    "cancelled",
  ]);
});

test("players see their meeting seat, late registrants see none, and pairing is untouched", async () => {
  const t = createConvexTest();
  const names = ["Alice", "Bob", "Cara", "Dan"];
  const { tournamentId, registrationIds } = await seedTournament(
    t,
    names.length,
    [{ phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true }],
    names,
  );
  const organizer = t.withIdentity(organizerIdentity);
  const playerOne = t.withIdentity(playerIdentity(1));
  const phaseId = await firstPhaseId(t, tournamentId);

  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId,
  });
  const current = await playerOne.query(
    api.tournaments.player.getMyCurrentMatch,
    { tournamentId },
  );
  if (current.kind !== "player_meeting") {
    throw new Error("Expected the player meeting to be live");
  }
  // Alice (player 1) sits at table 1 with Bob.
  expect(current.meeting.tableNumber).toBe(1);
  expect(current.meeting.seatmateName).toBe("Bob");

  // A player registering mid-meeting has no seat but still sees the meeting.
  const late = await t.run(async (ctx) => {
    const now = Date.now();
    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found in test setup");
    }
    const identity = playerIdentity(99);
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      publicCode: 99,
      email: identity.email,
      name: "Zed",
      updatedAt: now,
    });
    return await ctx.db.insert("tournamentRegistrations", {
      tournamentId,
      userId,
      tournamentStartDate: tournament.startDate,
      entryStatus: "confirmed",
      participationStatus: "active",
      playerName: "Zed",
      createdAt: now,
      tiebreakRandom: 1,
      updatedAt: now,
    });
  });
  const lateCurrent = await t
    .withIdentity(playerIdentity(99))
    .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
  if (lateCurrent.kind !== "player_meeting") {
    throw new Error("Expected the player meeting to be live");
  }
  expect(lateCurrent.meeting.tableNumber).toBeNull();

  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  const started = await playerOne.query(
    api.tournaments.player.getMyCurrentMatch,
    { tournamentId },
  );
  expect(started.kind).toBe("match");

  // The alphabetical seating never enters pairing history: round 1 pairs all
  // five actives (late registrant included) as a normal Swiss round.
  const roundOneCount = await t.run(async (ctx) => {
    const phase = await ctx.db.get(phaseId);
    const round = await ctx.db.get(phase!.phaseCurrentRound!);
    const matches = await ctx.db
      .query("tournamentMatches")
      .withIndex("by_tournamentRoundId", (q) =>
        q.eq("tournamentRoundId", round!._id),
      )
      .take(16);
    let count = 0;
    for (const match of matches) {
      const players = await ctx.db
        .query("tournamentMatchPlayers")
        .withIndex("by_tournamentMatchId_and_playerId", (q) =>
          q.eq("tournamentMatchId", match._id),
        )
        .take(2);
      count += players.length;
    }
    return count;
  });
  expect(roundOneCount).toBe(names.length + 1);
  expect(registrationIds).not.toContain(late);
});

test("deleteTournament clears meeting seats", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, 4, [
    { phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  const phaseId = await firstPhaseId(t, tournamentId);
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId,
  });

  await organizer.mutation(api.tournaments.lifecycle.deleteTournament, {
    tournamentId,
  });
  const remaining = await t.run(async (ctx) => {
    return await ctx.db
      .query("playerMeetingSeats")
      .withIndex("by_tournamentPhaseId_and_tableNumber", (q) =>
        q.eq("tournamentPhaseId", phaseId),
      )
      .take(16);
  });
  expect(remaining).toHaveLength(0);
});

test("a meeting cut stamps only its own tournament's withdrawals", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, 5, [
    {
      phaseOrder: 1,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      phaseCutoff: { kind: "top_X_players", playerCount: 3 },
    },
    {
      phaseOrder: 2,
      phaseRoundMode: "fixed",
      phaseTotalRounds: 1,
      playerMeeting: true,
    },
  ]);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  const board = await organizer.query(api.tournaments.rounds.getPairingsBoard, {
    tournamentId,
  });
  const phaseTwoId = board.phases[1].phase._id;
  const finalRoundId = board.phases[0].rounds[0]._id;
  const ranked = (
    await organizer.query(api.tournaments.rounds.listRoundStandings, {
      roundId: finalRoundId,
    })
  ).map(({ standing }) => standing.playerId);

  // A concurrent, unrelated event with its own withdrawn player. Nothing about
  // this row belongs to the cut below, and no standings row of this
  // tournament's ever mentions it.
  const otherRegistrationId = await t.run(async (ctx) => {
    const source = await ctx.db.get(tournamentId);
    if (!source) {
      throw new Error("Tournament not found in test setup");
    }
    const { _id, _creationTime, ...fields } = source;
    const otherTournamentId = await ctx.db.insert("tournaments", {
      ...fields,
      name: "Unrelated Event",
    });
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: "https://convex.test|other-tournament-player",
      publicCode: 9001,
      email: "other@example.test",
      name: "Other Player",
      updatedAt: Date.now(),
    });
    return await ctx.db.insert("tournamentRegistrations", {
      tournamentId: otherTournamentId,
      userId,
      tournamentStartDate: source.startDate,
      entryStatus: "confirmed",
      participationStatus: "dropped",
      playerName: "Other Player",
      createdAt: Date.now(),
      tiebreakRandom: 1,
      updatedAt: Date.now(),
    });
  });

  // The last-ranked player withdraws before the meeting, so they are unseated
  // and the cut must record their elimination.
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: ranked[4],
  });
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId: phaseTwoId,
  });
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });

  const rows = await t.run(async (ctx) => ({
    cut: await ctx.db.get(ranked[4]),
    other: await ctx.db.get(otherRegistrationId),
  }));
  expect(rows.cut).toMatchObject({
    participationStatus: "dropped",
    eliminatedByRoundId: finalRoundId,
  });
  expect(rows.other?.participationStatus).toBe("dropped");
  expect(rows.other?.eliminatedByRoundId).toBeUndefined();
});

async function seedTournament(
  t: TestConvex<typeof schema>,
  playerCount: number,
  phases: {
    phaseOrder: number;
    phaseRoundMode: "fixed" | "dynamic";
    phaseTotalRounds?: number;
    phaseCutoff?:
      | { kind: "top_X_players"; playerCount: number }
      | { kind: "X_points_or_more"; matchPoints: number }
      | null;
    playerMeeting?: boolean;
  }[] = [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3 }],
  playerNames?: string[],
) {
  const { organizationId } = await seedOrganizer(t);
  const tournamentId: Id<"tournaments"> = await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
      organizationId,
      name: "Player Meeting Event",
      startDate: Date.now(),
      playerCapacity: 16,
      format: "standard",
      phases,
    });
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.updatePairingsAutoPublish, {
      tournamentId,
      autoPublishPairings: true,
    });

  const registrationIds = await t.run(async (ctx) => {
    const now = Date.now();
    const tournament = await ctx.db.get(tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found in test setup");
    }
    const ids: Id<"tournamentRegistrations">[] = [];
    for (let playerNumber = 1; playerNumber <= playerCount; playerNumber += 1) {
      const identity = playerIdentity(playerNumber);
      const playerName =
        playerNames?.[playerNumber - 1] ?? `Player ${playerNumber}`;
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        publicCode: playerNumber,
        email: identity.email,
        name: playerName,
        updatedAt: now,
      });
      ids.push(
        await ctx.db.insert("tournamentRegistrations", {
          tournamentId,
          userId,
          tournamentStartDate: tournament.startDate,
          entryStatus: "confirmed",
          participationStatus: "active",
          playerName,
          createdAt: now + playerNumber,
          tiebreakRandom: playerNumber,
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
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.publishTournament, { tournamentId });

  return { tournamentId, registrationIds };
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
