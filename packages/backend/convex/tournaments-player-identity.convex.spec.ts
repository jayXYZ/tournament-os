/// <reference types="vite/client" />

import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  organizerIdentity,
  playOutCurrentRound,
  playerIdentity,
  seedTournamentWithPlayers,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

// A sign-in whose provider supplied no display name: the account carries an
// email and nothing else. Player-facing surfaces must show other players
// nothing for this account rather than its email (model/participants.ts
// participantPublicIdentity); organizer surfaces may keep the email as the
// roster's fallback label.
const NAMELESS_EMAIL = "nameless@example.test";
const namelessIdentity = {
  issuer: "https://convex.test",
  subject: "nameless",
  tokenIdentifier: "https://convex.test|nameless",
  email: NAMELESS_EMAIL,
};

test("standings never show another player's email in place of a missing name", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Nameless Standings Event",
    playerCount: 3,
    phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 1 }],
    playerNames: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  // Registers through the real sign-in + registration path, so the name
  // denormalized onto the registration (and from there onto standings) is
  // exactly what production would stamp.
  const namelessRegistrationId = await t
    .withIdentity(namelessIdentity)
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });

  await organizer.mutation(api.tournaments.rounds.startTournament, {
    tournamentId,
  });
  await playOutCurrentRound(t, tournamentId);

  const standings = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getLatestStandings, { tournamentId });
  expect(standings?.rows).toHaveLength(4);
  expect(JSON.stringify(standings)).not.toContain(NAMELESS_EMAIL);
  expect(
    standings?.rows
      .map((row) => row.name)
      .sort((a, b) => (a ?? "").localeCompare(b ?? "")),
  ).toEqual([null, "Player 1", "Player 2", "Player 3"]);

  // The organizer's roster keeps the email as the fallback label.
  const roster = await organizer.query(
    api.tournaments.registrations.listRegistrationPage,
    { tournamentId, paginationOpts: { numItems: 10, cursor: null } },
  );
  expect(
    roster.page.find((row) => row.registration._id === namelessRegistrationId)
      ?.playerName,
  ).toBe(NAMELESS_EMAIL);
  const round = await currentRound(t, tournamentId);
  const organizerStandings = await organizer.query(
    api.tournaments.rounds.listRoundStandings,
    { roundId: round },
  );
  expect(
    organizerStandings.find(
      ({ standing }) => standing.playerId === namelessRegistrationId,
    )?.playerName,
  ).toBe(NAMELESS_EMAIL);
});

test("a player meeting never shows a seatmate's email in place of a missing name", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Nameless Meeting Event",
    playerCount: 1,
    phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic", playerMeeting: true }],
    playerNames: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  await t
    .withIdentity(namelessIdentity)
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
  const phaseId = await firstPhaseId(t, tournamentId);
  await organizer.mutation(api.tournaments.playerMeeting.startPlayerMeeting, {
    phaseId,
  });

  const view = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.player.getMyCurrentMatch, { tournamentId });
  expect(view.kind).toBe("player_meeting");
  expect(JSON.stringify(view)).not.toContain(NAMELESS_EMAIL);
  if (view.kind === "player_meeting") {
    expect(view.meeting.tableNumber).toBe(1);
    expect(view.meeting.seatmateName).toBeNull();
  }

  // The organizer's seating list keeps the email as the fallback label.
  const seating = await organizer.query(
    api.tournaments.playerMeeting.listPlayerMeetingSeats,
    { phaseId },
  );
  expect(seating.seats.map((seat) => seat.playerName).sort()).toEqual([
    "Player 1",
    NAMELESS_EMAIL,
  ]);
});

test("the organizer audit log labels a nameless player by email", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournamentWithPlayers(t, {
    name: "Nameless Audit Event",
    playerCount: 2,
    playerNames: true,
  });
  const organizer = t.withIdentity(organizerIdentity);
  const namelessRegistrationId = await t
    .withIdentity(namelessIdentity)
    .mutation(api.tournaments.registrations.registerSelf, { tournamentId });
  await organizer.mutation(api.tournaments.registrations.dropRegistration, {
    registrationId: namelessRegistrationId,
  });

  // The stored rows carry the organizer label — the email — resolved once at
  // append time (the log is organizer-only), so the list query never reads
  // through to the user document...
  const stored = await t.run(async (ctx) =>
    (
      await ctx.db
        .query("tournamentAuditEvents")
        .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
        .collect()
    ).map((row) => row.event),
  );
  const storedNames = stored.flatMap((event) =>
    "player" in event && event.player.registrationId === namelessRegistrationId
      ? [event.player.playerName]
      : [],
  );
  expect(storedNames).toEqual([NAMELESS_EMAIL, NAMELESS_EMAIL]);

  // ...and the organizer-only list returns the rows as stored.
  const page = await organizer.query(api.tournaments.auditLog.listAuditEvents, {
    tournamentId,
    paginationOpts: { numItems: 20, cursor: null },
  });
  const labelled = page.page.flatMap(({ event }) =>
    "player" in event && event.player.registrationId === namelessRegistrationId
      ? [`${event.type}:${event.player.playerName}`]
      : [],
  );
  expect(labelled).toEqual([
    `registration_cancelled:${NAMELESS_EMAIL}`,
    `player_registered:${NAMELESS_EMAIL}`,
  ]);
});

async function currentRound(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  const round = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.rounds.getCurrentRound, { tournamentId });
  if (!round) {
    throw new Error("No current round in test setup");
  }
  return round._id;
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
