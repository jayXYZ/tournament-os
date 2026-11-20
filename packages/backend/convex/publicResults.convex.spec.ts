/// <reference types="vite/client" />

// Public Results (CONTEXT.md, model/publicResults.ts): the event page's
// standings and matches. The suite pins the boundary — who may read them
// (exactly getPublicTournament's viewers), what a held round leaves visible
// (nothing), and what the projection carries (no seed, no tiebreakRandom,
// no organizer-only fields) — alongside the content itself for Swiss and
// single-elimination play.
import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { publicPlayerName } from "./model/publicResults";
import schema from "./schema";
import {
  currentRound,
  organizerIdentity,
  playOutCurrentRound,
  playerIdentity,
  registerPlayers,
  seedOrganizer,
  seedTournamentWithPlayers,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

type Convex = TestConvex<typeof schema>;

test("a signed-out viewer reads a public event's standings and matches", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Public Results",
    playerCount: 5,
    playerNames: ["Ada", "Brook", "Cal", "Dee", "Eve"],
  });
  const publicCode = await publicCodeOf(t, tournamentId);
  await start(t, tournamentId);

  // Round one is live: its pairings are out (auto-release), nothing has
  // completed, so there are matches but no standings yet.
  const live = await t.query(api.tournaments.publicResults.getPublicMatches, {
    publicCode,
  });
  expect(live?.round).toMatchObject({
    roundNumber: 1,
    roundStatus: "in_progress",
    phaseType: "swiss",
  });
  expect(live?.phases).toHaveLength(1);
  expect(live?.matches).toHaveLength(3);
  const names = live!.matches.flatMap((match) =>
    match.players.map((player) => player.name),
  );
  expect(names.sort()).toEqual(["Ada", "Brook", "Cal", "Dee", "Eve"]);
  // Five players: one bye, completed at pairing time, without a table.
  const byes = live!.matches.filter((match) =>
    match.players.some((player) => player.isBye),
  );
  expect(byes).toHaveLength(1);
  expect(byes[0]).toMatchObject({
    tableNumber: null,
    matchStatus: "completed",
    resultKind: "bye",
  });
  expect(
    live!.matches.filter((match) => match.matchStatus === "upcoming"),
  ).toHaveLength(2);
  expect(
    await t.query(api.tournaments.publicResults.getPublicStandings, {
      publicCode,
    }),
  ).toEqual({ standings: null });

  // An organizer-entered result shows on the next read of the same query —
  // the page's subscription re-runs on exactly this write.
  const played = live!.matches.find((match) => match.tableNumber === 1)!;
  const pairing = await organizerPairing(t, tournamentId, 1);
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: pairing.match._id,
      playerOneRegistrationId: pairing.players[0].playerId,
      playerTwoRegistrationId: pairing.players[1].playerId,
      playerOneGameWins: 2,
      playerTwoGameWins: 1,
    });
  const afterResult = await t.query(
    api.tournaments.publicResults.getPublicMatches,
    { publicCode },
  );
  const updated = afterResult!.matches.find(
    (match) => match.matchId === played.matchId,
  );
  expect(updated).toMatchObject({
    matchStatus: "completed",
    resultKind: "played",
    playerReported: false,
  });
  expect(updated!.players.map((player) => player.gameWins)).toEqual([2, 1]);

  // Completing the round publishes its standings in rank order, with the
  // same tiebreak values the player standings show.
  await playOutCurrentRound(t, tournamentId);
  const standings = await t.query(
    api.tournaments.publicResults.getPublicStandings,
    { publicCode },
  );
  expect(standings?.standings?.roundNumber).toBe(1);
  expect(standings?.standings?.rows.map((row) => row.rank)).toEqual([
    1, 2, 3, 4, 5,
  ]);
  const player = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getLatestStandings, { tournamentId });
  expect(player?.rows.map(({ isMe: _isMe, ...row }) => row)).toEqual(
    standings?.standings?.rows,
  );
});

test("the projection carries no seed, tiebreakRandom, or organizer-only data", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Projection",
    playerCount: 4,
  });
  const publicCode = await publicCodeOf(t, tournamentId);
  await start(t, tournamentId);
  await playOutCurrentRound(t, tournamentId);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  // A scored match in the round being read, with an organizer's note on it.
  const pairing = await organizerPairing(t, tournamentId, 1);
  await organizer.mutation(api.tournaments.rounds.recordMatchResult, {
    matchId: pairing.match._id,
    playerOneRegistrationId: pairing.players[0].playerId,
    playerTwoRegistrationId: pairing.players[1].playerId,
    playerOneGameWins: 2,
    playerTwoGameWins: 0,
    note: "organizer-only-note",
  });

  const standings = await t.query(
    api.tournaments.publicResults.getPublicStandings,
    { publicCode },
  );
  const matches = await t.query(
    api.tournaments.publicResults.getPublicMatches,
    { publicCode },
  );
  expect(standings?.standings?.rows).toHaveLength(4);
  expect(matches?.round?.roundNumber).toBe(2);
  expect(
    matches?.matches.filter((match) => match.matchStatus === "completed"),
  ).toHaveLength(1);
  expect(JSON.stringify(matches)).not.toContain("organizer-only-note");

  const forbidden = [
    "seed",
    "tiebreakRandom",
    "playerId",
    "opponentIds",
    "opponentPlayerId",
    "reportedByRegistrationId",
    "email",
    "organizerLabel",
    "sortKey",
    "tournamentId",
    "note",
  ];
  for (const payload of [standings, matches]) {
    const keys = allKeys(payload);
    for (const key of forbidden) {
      expect(keys).not.toContain(key);
    }
  }
  // Names are the player-safe stamps — never an email.
  const serialized = JSON.stringify([standings, matches]);
  expect(serialized).not.toContain("@");
});

test("a private event's results need the same access as its page", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Private Results",
    playerCount: 4,
  });
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(
    api.tournaments.lifecycle.updateTournamentVisibility,
    { tournamentId, visibility: "private" },
  );
  const inviteCode = await organizer.mutation(
    api.tournaments.invites.regenerateInviteLink,
    { tournamentId },
  );
  const publicCode = await publicCodeOf(t, tournamentId);
  await start(t, tournamentId);
  await playOutCurrentRound(t, tournamentId);

  // Refused: signed out, a signed-in stranger, and a wrong code — the same
  // nulls getPublicTournament gives them.
  const stranger = t.withIdentity(playerIdentity(50));
  for (const [viewer, code] of [
    [t, undefined],
    [stranger, undefined],
    [t, "0000000000"],
  ] as const) {
    const args = { publicCode, inviteCode: code };
    expect(
      await viewer.query(api.tournaments.lifecycle.getPublicTournament, args),
    ).toBeNull();
    expect(
      await viewer.query(
        api.tournaments.publicResults.getPublicStandings,
        args,
      ),
    ).toBeNull();
    expect(
      await viewer.query(api.tournaments.publicResults.getPublicMatches, args),
    ).toBeNull();
  }

  // Admitted: the invite code, even signed out, and a registered player.
  for (const [viewer, code] of [
    [t, inviteCode],
    [t.withIdentity(playerIdentity(1)), undefined],
  ] as const) {
    const args = { publicCode, inviteCode: code };
    expect(
      await viewer.query(
        api.tournaments.publicResults.getPublicStandings,
        args,
      ),
    ).toMatchObject({ standings: { roundNumber: 1 } });
    expect(
      await viewer.query(api.tournaments.publicResults.getPublicMatches, args),
    ).toMatchObject({ round: { roundNumber: 1 } });
  }
});

test("a round held for the organizer is absent until its pairings are released", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Held Pairings",
    playerCount: 4,
    autoPublishPairings: false,
  });
  const publicCode = await publicCodeOf(t, tournamentId);
  await start(t, tournamentId);
  const held = await currentRound(t, tournamentId);
  expect(held.pairingsPublishedAt).toBeUndefined();

  // Nothing about round one shows, even when its id is asked for directly.
  for (const roundId of [undefined, held._id]) {
    expect(
      await t.query(api.tournaments.publicResults.getPublicMatches, {
        publicCode,
        roundId,
      }),
    ).toEqual({ phases: [], round: null, matches: [] });
  }
  expect(
    await t.query(api.tournaments.publicResults.getPublicStandings, {
      publicCode,
    }),
  ).toEqual({ standings: null });

  // Released, it appears.
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.rounds.publishPairings, {
    roundId: held._id,
  });
  const released = await t.query(
    api.tournaments.publicResults.getPublicMatches,
    { publicCode },
  );
  expect(released?.round?.roundId).toBe(held._id);
  expect(released?.matches).toHaveLength(2);

  // Round two is paired but held: the index lists only round one, the
  // default stays on it, and asking for round two by id answers the same.
  await playOutCurrentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  const second = await currentRound(t, tournamentId);
  expect(second.roundNumber).toBe(2);
  expect(second.pairingsPublishedAt).toBeUndefined();
  const byDefault = await t.query(
    api.tournaments.publicResults.getPublicMatches,
    { publicCode },
  );
  const byId = await t.query(api.tournaments.publicResults.getPublicMatches, {
    publicCode,
    roundId: second._id,
  });
  expect(byId).toEqual(byDefault);
  expect(byDefault?.phases[0].rounds.map((round) => round.roundNumber)).toEqual(
    [1],
  );
  expect(byDefault?.round).toMatchObject({
    roundNumber: 1,
    roundStatus: "completed",
  });
  // Standings stay on round one: the held round has no results to leak.
  expect(
    await t.query(api.tournaments.publicResults.getPublicStandings, {
      publicCode,
    }),
  ).toMatchObject({ standings: { roundNumber: 1 } });

  // A released round id from another event is ignored the same way.
  const otherEvent = await seedEventBeside(t, tournamentId, "Other", 4);
  await start(t, otherEvent);
  const otherRound = await currentRound(t, otherEvent);
  expect(otherRound.pairingsPublishedAt).toBeDefined();
  expect(
    await t.query(api.tournaments.publicResults.getPublicMatches, {
      publicCode,
      roundId: otherRound._id,
    }),
  ).toEqual(byDefault);
});

test("before play starts the results are empty, not refused", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Not Yet",
    playerCount: 4,
  });
  const publicCode = await publicCodeOf(t, tournamentId);
  expect(
    await t.query(api.tournaments.publicResults.getPublicStandings, {
      publicCode,
    }),
  ).toEqual({ standings: null });
  expect(
    await t.query(api.tournaments.publicResults.getPublicMatches, {
      publicCode,
    }),
  ).toEqual({ phases: [], round: null, matches: [] });
  // An unknown code is refused like the page.
  expect(
    await t.query(api.tournaments.publicResults.getPublicMatches, {
      publicCode: "ZZZZZZ",
    }),
  ).toBeNull();
});

test("earlier rounds stay reachable, and completed and cancelled events keep their record", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Full Run",
    playerCount: 4,
    phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 2 }],
  });
  const publicCode = await publicCodeOf(t, tournamentId);
  const organizer = t.withIdentity(organizerIdentity);
  await start(t, tournamentId);
  const { round: first } = await playOutCurrentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);
  await organizer.mutation(api.tournaments.lifecycle.completeTournament, {
    tournamentId,
  });

  const final = await t.query(api.tournaments.publicResults.getPublicMatches, {
    publicCode,
  });
  expect(final?.phases[0].rounds.map((round) => round.roundNumber)).toEqual([
    1, 2,
  ]);
  expect(final?.round?.roundNumber).toBe(2);
  const earlier = await t.query(
    api.tournaments.publicResults.getPublicMatches,
    { publicCode, roundId: first._id },
  );
  expect(earlier?.round?.roundNumber).toBe(1);
  expect(
    earlier?.matches.every((match) => match.matchStatus === "completed"),
  ).toBe(true);
  expect(
    await t.query(api.tournaments.publicResults.getPublicStandings, {
      publicCode,
    }),
  ).toMatchObject({ standings: { roundNumber: 2 } });

  // A cancelled event shows what it reached, including an unfinished
  // released round.
  const cancelled = await seedEventBeside(t, tournamentId, "Called Off", 4);
  const cancelledCode = await publicCodeOf(t, cancelled);
  await start(t, cancelled);
  await playOutCurrentRound(t, cancelled);
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId: cancelled,
  });
  await organizer.mutation(api.tournaments.lifecycle.cancelTournament, {
    tournamentId: cancelled,
  });
  expect(
    await t.query(api.tournaments.publicResults.getPublicStandings, {
      publicCode: cancelledCode,
    }),
  ).toMatchObject({ standings: { roundNumber: 1 } });
  expect(
    await t.query(api.tournaments.publicResults.getPublicMatches, {
      publicCode: cancelledCode,
    }),
  ).toMatchObject({ round: { roundNumber: 2, roundStatus: "in_progress" } });
});

test("a single-elimination phase shows its bracket rounds and playoff standings", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Bracket",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [
        {
          phaseOrder: 1,
          phaseType: "single_elimination",
          phaseRoundMode: "dynamic",
        },
      ],
    },
  );
  await organizer.mutation(
    api.tournaments.lifecycle.updatePairingsAutoPublish,
    { tournamentId, autoPublishPairings: true },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await registerPlayers(t, tournamentId, 6);
  const publicCode = await publicCodeOf(t, tournamentId);
  await start(t, tournamentId);

  // Six players in an eight-seat bracket: two byes and two played matches.
  const quarterfinals = await t.query(
    api.tournaments.publicResults.getPublicMatches,
    { publicCode },
  );
  expect(quarterfinals?.round).toMatchObject({
    roundName: "Quarterfinals",
    phaseType: "single_elimination",
  });
  expect(quarterfinals?.phases[0]).toMatchObject({
    phaseType: "single_elimination",
  });
  expect(
    quarterfinals?.matches.filter((match) =>
      match.players.some((player) => player.isBye),
    ),
  ).toHaveLength(2);
  expect(quarterfinals?.matches).toHaveLength(4);

  await playOutCurrentRound(t, tournamentId);
  const standings = await t.query(
    api.tournaments.publicResults.getPublicStandings,
    { publicCode },
  );
  const statuses = standings!.standings!.rows.map((row) => row.playoffStatus);
  expect(statuses.filter((status) => status === "active")).toHaveLength(4);
  expect(statuses.filter((status) => status === "eliminated")).toHaveLength(2);
  expect(
    standings!
      .standings!.rows.filter((row) => row.playoffStatus === "eliminated")
      .every((row) => row.eliminatedInRoundNumber === 1),
  ).toBe(true);
});

test("a held playoff round's cut stays out of the public standings until release", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Held Cut",
    playerCount: 4,
    autoPublishPairings: false,
    phases: [
      {
        phaseOrder: 1,
        phaseRoundMode: "fixed",
        phaseTotalRounds: 1,
        phaseCutoff: { kind: "top_X_players", playerCount: 2 },
      },
      {
        phaseOrder: 2,
        phaseType: "single_elimination",
        phaseRoundMode: "dynamic",
      },
    ],
  });
  const publicCode = await publicCodeOf(t, tournamentId);
  const organizer = t.withIdentity(organizerIdentity);
  const standings = async () =>
    await t.query(api.tournaments.publicResults.getPublicStandings, {
      publicCode,
    });
  await start(t, tournamentId);
  await organizer.mutation(api.tournaments.rounds.publishPairings, {
    roundId: (await currentRound(t, tournamentId))._id,
  });
  await playOutCurrentRound(t, tournamentId);

  // The Swiss phase is over and nobody is cut yet.
  const beforeCut = await standings();
  expect(
    beforeCut!.standings!.rows.map((row) => row.registrationStatus),
  ).toEqual(["active", "active", "active", "active"]);

  // Pairing the playoff applies the cut on the roster, but its pairings are
  // held, so the public standings are unchanged down to the last field.
  await organizer.mutation(api.tournaments.rounds.generateNextRound, {
    tournamentId,
  });
  // (currentRound reads phase one; the playoff is phase two's round.)
  const playoff = (await organizer.query(
    api.tournaments.rounds.getCurrentRound,
    {
      tournamentId,
    },
  ))!;
  expect(playoff.roundNumber).toBe(2);
  expect(playoff.pairingsPublishedAt).toBeUndefined();
  const eliminatedOnRoster = await t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("tournamentRegistrations")
          .withIndex(
            "by_tournamentId_and_entryStatus_and_participationStatus",
            (q) =>
              q
                .eq("tournamentId", tournamentId)
                .eq("entryStatus", "confirmed")
                .eq("participationStatus", "eliminated"),
          )
          .take(8)
      ).length,
  );
  expect(eliminatedOnRoster).toBe(2);
  expect(await standings()).toEqual(beforeCut);

  // Released, the cut shows: the bottom two are eliminated.
  await organizer.mutation(api.tournaments.rounds.publishPairings, {
    roundId: playoff._id,
  });
  const afterRelease = await standings();
  expect(
    afterRelease!.standings!.rows.map((row) => row.registrationStatus),
  ).toEqual(["active", "active", "eliminated", "eliminated"]);
});

test("an email address typed as a player's name is withheld from the public", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Email As Name",
    playerCount: 3,
    playerNames: ["Ada", "Brook", "Cal"],
    phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 2 }],
  });
  const publicCode = await publicCodeOf(t, tournamentId);
  const organizer = t.withIdentity(organizerIdentity);
  // The enrollment flow as an organizer can drive it: a guest enrolled by
  // email, then named with that same address.
  const registrationId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: "walkup@example.test" },
  );
  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId,
    displayName: "walkup@example.test",
  });
  const stamped = await t.run(async (ctx) => await ctx.db.get(registrationId));
  expect(stamped?.playerName).toBe("walkup@example.test");
  // Enrollment takes an address without a dotted domain too.
  const localId = await organizer.mutation(
    api.tournaments.registrations.enrollPlayer,
    { tournamentId, email: "local@club" },
  );
  await organizer.mutation(api.tournaments.registrations.continueAsGuest, {
    registrationId: localId,
    displayName: "local@club",
  });

  await start(t, tournamentId);
  const matches = await t.query(
    api.tournaments.publicResults.getPublicMatches,
    { publicCode },
  );
  const matchNames = matches!.matches.flatMap((match) =>
    match.players.map((player) => player.name),
  );
  // Five players: four names across two matches, and one on the bye.
  expect(matchNames).toHaveLength(5);
  expect(matchNames.filter((name) => name === null)).toHaveLength(2);
  expect(JSON.stringify(matches)).not.toContain("@");

  await playOutCurrentRound(t, tournamentId);
  const standings = await t.query(
    api.tournaments.publicResults.getPublicStandings,
    { publicCode },
  );
  const standingNames = standings!.standings!.rows.map((row) => row.name);
  expect(standingNames.filter((name) => name === null)).toHaveLength(2);
  expect(standingNames.filter((name) => name !== null).sort()).toEqual([
    "Ada",
    "Brook",
    "Cal",
  ]);
  expect(JSON.stringify(standings)).not.toContain("@");

  // The shape is anything either side of an "@": a pasted address can carry
  // a zero-width character or a space that a stricter pattern would miss.
  for (const address of [
    "alex\uFEFF@example.test",
    "alex @example.test",
    "alex@ example.test",
  ]) {
    expect(publicPlayerName(address)).toBeNull();
  }
  // A handle and an ordinary name are not addresses.
  expect(publicPlayerName("@alex")).toBe("@alex");
  expect(publicPlayerName("Alex")).toBe("Alex");

  // The filter is the public seam's: the player standings keep the stored
  // name, which every entrant could already read.
  const playerRows = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getLatestStandings, { tournamentId });
  expect(
    playerRows?.rows.map((row) => row.name).filter((name) => name === null),
  ).toEqual([]);
});

test("a cancelled event's public results are frozen", async () => {
  const t = createConvexTest();
  const organizer = t.withIdentity(organizerIdentity);

  // Held pairings cannot be released after the cancel.
  const { tournamentId: heldEvent } = await seedTournamentWithPlayers(t, {
    name: "Cancelled While Held",
    playerCount: 4,
    autoPublishPairings: false,
  });
  const heldCode = await publicCodeOf(t, heldEvent);
  await start(t, heldEvent);
  const held = await currentRound(t, heldEvent);
  await organizer.mutation(api.tournaments.lifecycle.cancelTournament, {
    tournamentId: heldEvent,
  });
  await expect(
    organizer.mutation(api.tournaments.rounds.publishPairings, {
      roundId: held._id,
    }),
  ).rejects.toThrow("Tournament is not in progress");
  expect(
    await t.query(api.tournaments.publicResults.getPublicMatches, {
      publicCode: heldCode,
    }),
  ).toEqual({ phases: [], round: null, matches: [] });

  // A released round's scores cannot change after the cancel.
  const liveEvent = await seedEventBeside(t, heldEvent, "Cancelled Live", 4);
  const liveCode = await publicCodeOf(t, liveEvent);
  await start(t, liveEvent);
  const pairing = await organizerPairing(t, liveEvent, 1);
  await organizer.mutation(api.tournaments.lifecycle.cancelTournament, {
    tournamentId: liveEvent,
  });
  const atCancel = await t.query(
    api.tournaments.publicResults.getPublicMatches,
    { publicCode: liveCode },
  );
  expect(atCancel?.matches).toHaveLength(2);
  await expect(
    organizer.mutation(api.tournaments.rounds.recordMatchResult, {
      matchId: pairing.match._id,
      playerOneRegistrationId: pairing.players[0].playerId,
      playerTwoRegistrationId: pairing.players[1].playerId,
      playerOneGameWins: 2,
      playerTwoGameWins: 0,
    }),
  ).rejects.toThrow("Tournament is not in progress");
  // Nor through a test event's simulated results.
  await t.run(
    async (ctx) => await ctx.db.patch(liveEvent, { isTestEvent: true }),
  );
  await expect(
    organizer.mutation(api.tournaments.testing.generateTestRoundResults, {
      tournamentId: liveEvent,
    }),
  ).rejects.toThrow("Tournament is not in progress");
  expect(
    await t.query(api.tournaments.publicResults.getPublicMatches, {
      publicCode: liveCode,
    }),
  ).toEqual(atCancel);
  // Publishing pairings that were already released stays a no-op.
  await organizer.mutation(api.tournaments.rounds.publishPairings, {
    roundId: (await currentRound(t, liveEvent))._id,
  });
});

async function start(t: Convex, tournamentId: Id<"tournaments">) {
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.startTournament, { tournamentId });
}

async function publicCodeOf(t: Convex, tournamentId: Id<"tournaments">) {
  const tournament = await t.run(async (ctx) => await ctx.db.get(tournamentId));
  if (!tournament) {
    throw new Error("Tournament not found in test setup");
  }
  return tournament.publicCode;
}

// The organizer's view of the current round's pairing at a table.
async function organizerPairing(
  t: Convex,
  tournamentId: Id<"tournaments">,
  tableNumber: number,
) {
  const round = await currentRound(t, tournamentId);
  const pairings = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.rounds.listRoundPairings, { roundId: round._id });
  const pairing = pairings.find(
    ({ match }) => match.tableNumber === tableNumber,
  );
  if (!pairing || pairing.players.length !== 2) {
    throw new Error("Pairing not found in test setup");
  }
  return pairing;
}

// A second event in the first one's organization (seedTournamentWithPlayers
// seeds a fresh organizer, so it serves only the first), with the same
// player accounts registered and pairings released automatically.
async function seedEventBeside(
  t: Convex,
  firstTournamentId: Id<"tournaments">,
  name: string,
  playerCount: number,
) {
  const first = await t.run(async (ctx) => await ctx.db.get(firstTournamentId));
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId: first!.organizationId,
      name,
      startDate: Date.now(),
      playerCapacity: 16,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3 }],
    },
  );
  await organizer.mutation(
    api.tournaments.lifecycle.updatePairingsAutoPublish,
    { tournamentId, autoPublishPairings: true },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await registerPlayers(t, tournamentId, playerCount);
  return tournamentId;
}

function allKeys(value: unknown, into: Set<string> = new Set()): string[] {
  if (Array.isArray(value)) {
    for (const item of value) {
      allKeys(item, into);
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      allKeys(child, into);
    }
  }
  return [...into];
}
