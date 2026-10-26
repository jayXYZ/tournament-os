/// <reference types="vite/client" />

import type { TestConvex } from "convex-test";
import { describe, expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  matchForPlayer,
  opponentNumber,
  organizerIdentity,
  outsiderNumber,
  playOutCurrentRound,
  playerIdentity,
  seedOrganizer,
  seedTournamentWithPlayers,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

test("result reports and organizer overrides are audited", async () => {
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
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: match._id,
      playerOneRegistrationId: registrationIds[0],
      playerTwoRegistrationId: registrationIds[opponent - 1],
      playerOneGameWins: 0,
      playerTwoGameWins: 2,
    });

  // Newest first: override, report, tournament start, the seeded players'
  // registrations, publish.
  const events = await auditEvents(t, tournamentId);
  expect(events.map((row) => row.event.type)).toEqual([
    "match_result_recorded",
    "match_result_reported",
    "tournament_started",
    ...Array<string>(4).fill("player_registered"),
    "tournament_published",
  ]);

  const reported = events[1];
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
    1,
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
  const t = createConvexTest();
  const { tournamentId, registrationIds } = await seedTournament(t, 4);
  const organizer = t.withIdentity(organizerIdentity);

  // A new player registers themselves, then cancels.
  const playerFive = t.withIdentity(playerIdentity(5));
  await playerFive.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId,
  });
  await playerFive.mutation(
    api.tournaments.registrations.cancelMyRegistration,
    {
      tournamentId,
    },
  );

  // The organizer drops and reinstates player 1.
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: registrationIds[0],
  });
  await organizer.mutation(
    api.tournaments.registrations.reinstateRegistration,
    {
      registrationId: registrationIds[0],
    },
  );

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
    // The mid-round drop concedes player 2's unfinished match alongside the
    // drop itself.
    ["match_conceded", "player", "Player 2"],
    ["player_dropped", "player", "Player 2"],
    ["tournament_started", "organizer", "Organizer"],
    ["player_reinstated", "organizer", "Organizer"],
    ["registration_cancelled", "organizer", "Organizer"],
    ["registration_cancelled", "player", "Player 5"],
    ["player_registered", "player", "Player 5"],
    ...[4, 3, 2, 1].map((n) => ["player_registered", "player", `Player ${n}`]),
    ["tournament_published", "organizer", "Organizer"],
  ]);

  // Organizer-initiated pre-play cancellations name the affected player, not
  // the actor.
  const organizerDrop = events[4];
  if (organizerDrop.event.type !== "registration_cancelled") {
    throw new Error("Expected a registration cancellation event");
  }
  expect(organizerDrop.event.player.registrationId).toBe(registrationIds[0]);
});

test("round and tournament lifecycle actions are audited", async () => {
  const t = createConvexTest();
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
    ...Array<string>(4).fill("player_registered"),
    "tournament_published",
  ]);
  const roundStarted = lifecycleEvents[2];
  if (roundStarted.event.type !== "round_started") {
    throw new Error("Expected a round-started event");
  }
  expect(roundStarted.event.roundNumber).toBe(2);
  expect(roundStarted.event.playerCount).toBe(4);
});

test("cancelTournament is audited", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, 4);
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.cancelTournament, { tournamentId });

  const [latest] = await auditEvents(t, tournamentId);
  expect(latest.event.type).toBe("tournament_cancelled");
  expect(latest.actorRole).toBe("organizer");
});

test("listAuditEvents is organizer-only and paginates newest first", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedStartedTournament(t, 4);

  await expect(
    t
      .withIdentity(playerIdentity(1))
      .query(api.tournaments.auditLog.listAuditEvents, {
        tournamentId,
        paginationOpts: { numItems: 10, cursor: null },
      }),
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
  // The remaining events end with the oldest: tournament publication.
  expect(secondPage.page[secondPage.page.length - 1].event.type).toBe(
    "tournament_published",
  );
});

test("listAuditEvents clamps an oversized page size instead of reading the whole trail", async () => {
  const t = createConvexTest();
  const { organizationId, userId: organizerId } = await seedOrganizer(t);
  const tournamentId: Id<"tournaments"> = await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.createTournamentWithPhases, {
      organizationId,
      name: "Oversized Audit Trail",
      startDate: Date.now(),
      playerCapacity: 16,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3 }],
    });

  const ROW_COUNT = 150;
  await t.run(async (ctx) => {
    for (let index = 0; index < ROW_COUNT; index += 1) {
      await ctx.db.insert("tournamentAuditEvents", {
        tournamentId,
        actorUserId: organizerId,
        actorName: organizerIdentity.name,
        actorRole: "organizer",
        event: { type: "tournament_published" },
      });
    }
  });

  // Before the fix, paginationOpts was forwarded to .paginate() unmodified,
  // so a hostile/oversized numItems would attempt to read the whole trail in
  // one page instead of settling at the server's clamp.
  const oversized = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.auditLog.listAuditEvents, {
      tournamentId,
      paginationOpts: { numItems: Number.MAX_SAFE_INTEGER, cursor: null },
    });
  expect(oversized.page).toHaveLength(100);
  expect(oversized.isDone).toBe(false);

  const remainder = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.auditLog.listAuditEvents, {
      tournamentId,
      paginationOpts: {
        numItems: Number.MAX_SAFE_INTEGER,
        cursor: oversized.continueCursor,
      },
    });
  expect(remainder.page).toHaveLength(ROW_COUNT - 100);
  expect(remainder.isDone).toBe(true);
});

test("deleting a tournament removes its audit trail", async () => {
  const t = createConvexTest();
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
  phases?: {
    phaseOrder: number;
    phaseRoundMode: "fixed" | "dynamic";
    phaseTotalRounds?: number;
  }[],
) {
  return await seedTournamentWithPlayers(t, {
    name: "Audit Log Event",
    playerCount,
    phases,
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

describe("pairings publication", () => {
  test("an explicit publication is audited once with its organizer and round", async () => {
    const t = createConvexTest();
    const { tournamentId } = await seedTournamentWithPlayers(t, {
      name: "Publication Audit",
      playerCount: 4,
      autoPublishPairings: false,
    });
    const organizer = t.withIdentity(organizerIdentity);
    const roundId = await organizer.mutation(
      api.tournaments.rounds.startTournament,
      { tournamentId },
    );
    const beforePublication = await auditEvents(t, tournamentId);

    // A refused publication writes nothing and appends nothing.
    await expect(
      t
        .withIdentity(playerIdentity(1))
        .mutation(api.tournaments.rounds.publishPairings, { roundId }),
    ).rejects.toThrow();
    expect(await auditEvents(t, tournamentId)).toEqual(beforePublication);

    await organizer.mutation(api.tournaments.rounds.publishPairings, {
      roundId,
    });
    // Publishing already-public pairings is an idempotent no-op.
    await organizer.mutation(api.tournaments.rounds.publishPairings, {
      roundId,
    });

    const publications = (await auditEvents(t, tournamentId)).filter(
      (row) => row.event.type === "pairings_published",
    );
    expect(publications).toHaveLength(1);
    expect(publications[0]).toMatchObject({
      actorName: organizerIdentity.name,
      actorRole: "organizer",
      event: { type: "pairings_published", roundId, roundNumber: 1 },
    });
    const round = await organizer.query(
      api.tournaments.rounds.getCurrentRound,
      { tournamentId },
    );
    expect(round?.pairingsPublishedAt).toBeDefined();
  });

  // Auto-published at pairing time, or held and then published by
  // completeRound as part of the record: either way the enclosing round
  // event covers it.
  test.each([{ autoPublishPairings: true }, { autoPublishPairings: false }])(
    "implicit publication logs no publication row (autoPublishPairings: $autoPublishPairings)",
    async ({ autoPublishPairings }) => {
      const t = createConvexTest();
      const { tournamentId } = await seedTournamentWithPlayers(t, {
        name: "Implicit Publication Audit",
        playerCount: 4,
        autoPublishPairings,
      });
      await t
        .withIdentity(organizerIdentity)
        .mutation(api.tournaments.rounds.startTournament, { tournamentId });
      await playOutCurrentRound(t, tournamentId);

      const types = (await auditEvents(t, tournamentId)).map(
        (row) => row.event.type,
      );
      expect(types).toContain("round_completed");
      expect(types).not.toContain("pairings_published");
    },
  );
});

describe("round timer", () => {
  test("timer controls journal before/after anchors; failures and no-ops stay silent", async () => {
    const t = createConvexTest();
    const { tournamentId } = await seedStartedTournament(t, 4);
    const organizer = t.withIdentity(organizerIdentity);
    const durationMs = 45 * 60_000;

    await organizer.mutation(api.tournaments.timer.setRoundDuration, {
      tournamentId,
      durationMs,
    });
    // Re-saving the same default changes nothing.
    await organizer.mutation(api.tournaments.timer.setRoundDuration, {
      tournamentId,
      durationMs,
    });
    await organizer.mutation(api.tournaments.timer.setRoundDuration, {
      tournamentId,
      durationMs: 40 * 60_000,
    });
    await organizer.mutation(api.tournaments.timer.startTimer, {
      tournamentId,
    });
    await organizer.mutation(api.tournaments.timer.pauseTimer, {
      tournamentId,
    });
    await organizer.mutation(api.tournaments.timer.adjustTimer, {
      tournamentId,
      deltaMs: 60_000,
    });
    await organizer.mutation(api.tournaments.timer.resumeTimer, {
      tournamentId,
    });
    await organizer.mutation(api.tournaments.timer.startTimer, {
      tournamentId,
    });
    await organizer.mutation(api.tournaments.timer.clearTimer, {
      tournamentId,
    });

    const events = await auditEvents(t, tournamentId);
    const durationChanges = events
      .map((row) => row.event)
      .filter((event) => event.type === "round_duration_changed")
      .reverse();
    expect(durationChanges).toEqual([
      {
        type: "round_duration_changed",
        previousDurationMs: null,
        durationMs,
      },
      {
        type: "round_duration_changed",
        previousDurationMs: durationMs,
        durationMs: 40 * 60_000,
      },
    ]);

    const timerRows = events.filter(
      (row) => row.event.type === "round_timer_changed",
    );
    expect(timerRows.every((row) => row.actorRole === "organizer")).toBe(true);
    const timerChanges = timerRows
      .map((row) => row.event)
      .filter((event) => event.type === "round_timer_changed")
      .reverse();
    expect(timerChanges.map((event) => event.operation)).toEqual([
      "started",
      "paused",
      "adjusted",
      "resumed",
      "started",
      "cleared",
    ]);
    // The rows chain: each change starts from the timer the previous one
    // left, from no timer to no timer.
    expect(timerChanges[0].previousTimer).toBeNull();
    expect(timerChanges[0].timer).toMatchObject({
      kind: "running",
      durationMs: 40 * 60_000,
    });
    for (let index = 1; index < timerChanges.length; index += 1) {
      expect(timerChanges[index].previousTimer).toEqual(
        timerChanges[index - 1].timer,
      );
    }
    expect(timerChanges[1].timer?.kind).toBe("paused");
    const [paused, adjusted] = [timerChanges[1].timer, timerChanges[2].timer];
    if (paused?.kind !== "paused" || adjusted?.kind !== "paused") {
      throw new Error("Expected the adjustment to land on a paused timer");
    }
    expect(adjusted.remainingMs - paused.remainingMs).toBe(60_000);
    expect(timerChanges.at(-1)?.timer).toBeNull();
    const { tournament } = await organizer.query(
      api.tournaments.lifecycle.getTournamentSetup,
      { tournamentId },
    );
    expect(tournament.roundTimer).toBeUndefined();

    // Clearing an absent timer and every refused control append nothing.
    await organizer.mutation(api.tournaments.timer.clearTimer, {
      tournamentId,
    });
    await expect(
      organizer.mutation(api.tournaments.timer.pauseTimer, { tournamentId }),
    ).rejects.toThrow("Timer is not running");
    await expect(
      organizer.mutation(api.tournaments.timer.adjustTimer, {
        tournamentId,
        deltaMs: 60_000,
      }),
    ).rejects.toThrow("No timer to adjust");
    await expect(
      organizer.mutation(api.tournaments.timer.setRoundDuration, {
        tournamentId,
        durationMs: 1,
      }),
    ).rejects.toThrow("Invalid round duration");
    await expect(
      t
        .withIdentity(playerIdentity(1))
        .mutation(api.tournaments.timer.startTimer, { tournamentId }),
    ).rejects.toThrow();
    expect(await auditEvents(t, tournamentId)).toEqual(events);
  });

  test("lifecycle timer cleanup is part of the lifecycle event, not a timer row", async () => {
    const t = createConvexTest();
    const { tournamentId } = await seedStartedTournament(t, 4);
    const organizer = t.withIdentity(organizerIdentity);
    const timerRowCount = async () =>
      (await auditEvents(t, tournamentId)).filter(
        (row) => row.event.type === "round_timer_changed",
      ).length;

    // Completing the round clears its timer under round_completed.
    await organizer.mutation(api.tournaments.timer.startTimer, {
      tournamentId,
    });
    expect(await timerRowCount()).toBe(1);
    await playOutCurrentRound(t, tournamentId);
    expect(await timerRowCount()).toBe(1);

    // Cancelling clears a live timer under tournament_cancelled.
    await organizer.mutation(api.tournaments.rounds.generateNextRound, {
      tournamentId,
    });
    await organizer.mutation(api.tournaments.timer.startTimer, {
      tournamentId,
    });
    const beforeCancel = await auditEvents(t, tournamentId);
    await organizer.mutation(api.tournaments.lifecycle.cancelTournament, {
      tournamentId,
    });
    const afterCancel = await auditEvents(t, tournamentId);
    expect(afterCancel.slice(1)).toEqual(beforeCancel);
    expect(afterCancel[0].event.type).toBe("tournament_cancelled");
    const { tournament } = await organizer.query(
      api.tournaments.lifecycle.getTournamentSetup,
      { tournamentId },
    );
    expect(tournament.roundTimer).toBeUndefined();
  });
});

describe("round_started", () => {
  test("logs the stored number of the round it created, across a phase boundary", async () => {
    const t = createConvexTest();
    const { tournamentId } = await seedTournament(t, 4, [
      { phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 },
      { phaseOrder: 2, phaseRoundMode: "fixed", phaseTotalRounds: 1 },
    ]);
    const organizer = t.withIdentity(organizerIdentity);
    await organizer.mutation(api.tournaments.rounds.startTournament, {
      tournamentId,
    });
    await playOutCurrentRound(t, tournamentId);
    const roundId = await organizer.mutation(
      api.tournaments.rounds.generateNextRound,
      { tournamentId },
    );
    const round = await organizer.query(
      api.tournaments.rounds.getCurrentRound,
      { tournamentId },
    );
    expect(round?._id).toBe(roundId);

    const [latest] = await auditEvents(t, tournamentId);
    expect(latest.event).toEqual({
      type: "round_started",
      roundId,
      roundNumber: round?.roundNumber,
      playerCount: 4,
    });
    expect(round?.roundNumber).toBe(2);
  });
});

describe("refused writes append nothing", () => {
  test("lifecycle, registration, and decklist refusals leave the journal untouched", async () => {
    const t = createConvexTest();
    const { tournamentId } = await seedTournament(t, 4);
    const organizer = t.withIdentity(organizerIdentity);
    const player = t.withIdentity(playerIdentity(1));
    const before = await auditEvents(t, tournamentId);

    await expect(
      organizer.mutation(api.tournaments.lifecycle.publishTournament, {
        tournamentId,
      }),
    ).rejects.toThrow();
    await expect(
      player.mutation(api.tournaments.registrations.registerSelf, {
        tournamentId,
      }),
    ).rejects.toThrow("Already registered");
    await expect(
      player.mutation(api.tournaments.decklists.submitMyDecklist, {
        tournamentId,
        maindeck: [{ name: "Island", quantity: 60 }],
        sideboard: [],
      }),
    ).rejects.toThrow("This tournament does not collect decklists");
    expect(await auditEvents(t, tournamentId)).toEqual(before);

    await organizer.mutation(api.tournaments.lifecycle.cancelTournament, {
      tournamentId,
    });
    await expect(
      organizer.mutation(api.tournaments.lifecycle.cancelTournament, {
        tournamentId,
      }),
    ).rejects.toThrow("Tournament is already cancelled");
    const after = await auditEvents(t, tournamentId);
    expect(after.slice(1)).toEqual(before);
    expect(after[0].event.type).toBe("tournament_cancelled");
  });
});
