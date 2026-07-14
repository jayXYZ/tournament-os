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

test("phase-1 meeting walks startPlayerMeeting -> startTournament -> completed", async () => {
  const t = convexTest(schema, modules);
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
  const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
    const t = convexTest(schema, modules);
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
  const t = convexTest(schema, modules);
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
  expect(droppedSeat?.registrationStatus).toBe("dropped");
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

test("a later phase holds its own meeting between phases", async () => {
  const t = convexTest(schema, modules);
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

test("players see their meeting seat, late registrants see none, and pairing is untouched", async () => {
  const t = convexTest(schema, modules);
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
      status: "active",
      playerName: "Zed",
      createdAt: now,
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
  const t = convexTest(schema, modules);
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

async function seedTournament(
  t: TestConvex<typeof schema>,
  playerCount: number,
  phases: {
    phaseOrder: number;
    phaseRoundMode: "fixed" | "dynamic";
    phaseTotalRounds?: number;
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
          status: "active",
          playerName,
          createdAt: now + playerNumber,
          updatedAt: now,
        }),
      );
    }
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
