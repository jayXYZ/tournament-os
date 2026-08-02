/// <reference types="vite/client" />

import { convexTest, type TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { organizerIdentity, seedOrganizer } from "./specHelpers";

const modules = import.meta.glob("./**/*.ts");

function playerIdentity(playerNumber: number) {
  return {
    issuer: "https://convex.test",
    subject: `player-${playerNumber}`,
    tokenIdentifier: `https://convex.test|player-${playerNumber}`,
    email: `player${playerNumber}@example.test`,
    name: `Player ${playerNumber}`,
  };
}

// A published tournament open for registration, with playerCount confirmed
// active players seeded directly (the pattern the player suite uses; the
// organizer's publicCode sits above the players' range so the manually
// assigned codes never collide).
async function seedOpenTournament(
  t: TestConvex<typeof schema>,
  playerCount: number,
  decklistRequired = true,
) {
  const { organizationId } = await seedOrganizer(t, 999);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Decklist Event",
      startDate: Date.now(),
      playerCapacity: 16,
      format: "standard",
      decklistRequired,
      phases: [{ phaseOrder: 1, phaseRoundMode: "fixed", phaseTotalRounds: 3 }],
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
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
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        publicCode: playerNumber,
        email: identity.email,
        name: identity.name,
        updatedAt: now,
      });
      ids.push(
        await ctx.db.insert("tournamentRegistrations", {
          tournamentId,
          userId,
          tournamentStartDate: tournament.startDate,
          entryStatus: "confirmed",
          participationStatus: "active",
          playerName: identity.name,
          createdAt: now + playerNumber,
          updatedAt: now + playerNumber,
        }),
      );
    }
    await ctx.db.patch(tournamentId, {
      confirmedRegistrationCount: playerCount,
    });
    return ids;
  });

  return { tournamentId, registrationIds };
}

async function decklistAuditEvents(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
) {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("tournamentAuditEvents")
      .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
      .take(50);
    return rows.filter((row) => row.event.type === "decklist_submitted");
  });
}

test("submitMyDecklist normalizes the boards and getMyDecklist returns them", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId, registrationIds } = await seedOpenTournament(t, 1);

  const decklistId = await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.decklists.submitMyDecklist, {
      tournamentId,
      deckName: "  Burn  ",
      // Duplicate entries (with stray whitespace and casing differences)
      // must merge into the first occurrence.
      maindeck: [
        { name: "  Lightning Bolt ", quantity: 3 },
        { name: "Mountain", quantity: 20 },
        { name: "lightning bolt", quantity: 1 },
      ],
      sideboard: [{ name: "Pyroblast", quantity: 4 }],
      rawText: "3 Lightning Bolt\n20 Mountain\n1 lightning bolt\n\n4 Pyroblast",
    });

  const result = await t
    .withIdentity(playerIdentity(1))
    .query(api.tournaments.decklists.getMyDecklist, { tournamentId });
  expect(result?.submissionOpen).toBe(true);
  expect(result?.decklist?._id).toBe(decklistId);
  expect(result?.decklist?.registrationId).toBe(registrationIds[0]);
  expect(result?.decklist?.deckName).toBe("Burn");
  expect(result?.decklist?.maindeck).toEqual([
    { name: "Lightning Bolt", quantity: 4 },
    { name: "Mountain", quantity: 20 },
  ]);
  expect(result?.decklist?.sideboard).toEqual([
    { name: "Pyroblast", quantity: 4 },
  ]);
  expect(result?.decklist?.rawText).toBe(
    "3 Lightning Bolt\n20 Mountain\n1 lightning bolt\n\n4 Pyroblast",
  );

  // The roster's denormalized copy is written through in the same mutation.
  const registration = await t.run(
    async (ctx) => await ctx.db.get(registrationIds[0]),
  );
  expect(registration?.decklistId).toBe(decklistId);
  expect(registration?.deckName).toBe("Burn");

  const audited = await decklistAuditEvents(t, tournamentId);
  expect(audited).toHaveLength(1);
  expect(audited[0].actorRole).toBe("player");
  expect(audited[0].event).toMatchObject({
    type: "decklist_submitted",
    player: { registrationId: registrationIds[0], playerName: "Player 1" },
    maindeckCardCount: 24,
    sideboardCardCount: 4,
    isUpdate: false,
  });
});

test("resubmitting replaces the list in place and clears omitted fields", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId, registrationIds } = await seedOpenTournament(t, 1);
  const player = t.withIdentity(playerIdentity(1));

  const firstId = await player.mutation(
    api.tournaments.decklists.submitMyDecklist,
    {
      tournamentId,
      deckName: "Burn",
      maindeck: [{ name: "Lightning Bolt", quantity: 4 }],
      sideboard: [],
      rawText: "4 Lightning Bolt",
    },
  );
  const secondId = await player.mutation(
    api.tournaments.decklists.submitMyDecklist,
    {
      tournamentId,
      maindeck: [{ name: "Island", quantity: 60 }],
      sideboard: [{ name: "Pyroblast", quantity: 4 }],
    },
  );
  expect(secondId).toBe(firstId);

  const result = await player.query(api.tournaments.decklists.getMyDecklist, {
    tournamentId,
  });
  expect(result?.decklist?.deckName).toBeUndefined();
  expect(result?.decklist?.rawText).toBeUndefined();
  expect(result?.decklist?.maindeck).toEqual([
    { name: "Island", quantity: 60 },
  ]);

  const rowCount = await t.run(async (ctx) => {
    const rows = await ctx.db
      .query("tournamentDecklists")
      .withIndex("by_registrationId", (q) =>
        q.eq("registrationId", registrationIds[0]),
      )
      .take(10);
    return rows.length;
  });
  expect(rowCount).toBe(1);

  // The denormalized copy tracks the resubmission: the id survives, the
  // dropped name clears.
  const registration = await t.run(
    async (ctx) => await ctx.db.get(registrationIds[0]),
  );
  expect(registration?.decklistId).toBe(firstId);
  expect(registration?.deckName).toBeUndefined();

  const audited = await decklistAuditEvents(t, tournamentId);
  expect(audited).toHaveLength(2);
  expect(audited[1].event).toMatchObject({
    maindeckCardCount: 60,
    sideboardCardCount: 4,
    isUpdate: true,
  });
});

test("submitMyDecklist rejects signed-out, unregistered, and malformed submissions", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedOpenTournament(t, 1);
  const validBoards = {
    tournamentId,
    maindeck: [{ name: "Island", quantity: 60 }],
    sideboard: [],
  };

  await expect(
    t.mutation(api.tournaments.decklists.submitMyDecklist, validBoards),
  ).rejects.toThrow("Not authenticated");

  await expect(
    t
      .withIdentity(playerIdentity(99))
      .mutation(api.tournaments.decklists.submitMyDecklist, validBoards),
  ).rejects.toThrow("You are not registered for this tournament");

  const player = t.withIdentity(playerIdentity(1));
  await expect(
    player.mutation(api.tournaments.decklists.submitMyDecklist, {
      tournamentId,
      maindeck: [{ name: "Island", quantity: 0 }],
      sideboard: [],
    }),
  ).rejects.toThrow("positive whole numbers");
  await expect(
    player.mutation(api.tournaments.decklists.submitMyDecklist, {
      tournamentId,
      maindeck: [{ name: "Island", quantity: 1.5 }],
      sideboard: [],
    }),
  ).rejects.toThrow("positive whole numbers");
  await expect(
    player.mutation(api.tournaments.decklists.submitMyDecklist, {
      tournamentId,
      maindeck: [{ name: "   ", quantity: 1 }],
      sideboard: [],
    }),
  ).rejects.toThrow("empty card name");
  await expect(
    player.mutation(api.tournaments.decklists.submitMyDecklist, {
      tournamentId,
      maindeck: [],
      sideboard: [{ name: "Pyroblast", quantity: 4 }],
    }),
  ).rejects.toThrow("Maindeck cannot be empty");
});

test("decklist submission closes once the tournament starts", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedOpenTournament(t, 4);
  const player = t.withIdentity(playerIdentity(1));

  await player.mutation(api.tournaments.decklists.submitMyDecklist, {
    tournamentId,
    maindeck: [{ name: "Island", quantity: 60 }],
    sideboard: [],
  });
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.rounds.startTournament, { tournamentId });

  // The stored list stays readable, but the server reports the editor closed
  // and refuses replacements — from players who already submitted and from
  // ones who never did.
  const result = await player.query(api.tournaments.decklists.getMyDecklist, {
    tournamentId,
  });
  expect(result?.submissionOpen).toBe(false);
  expect(result?.decklist?.maindeck).toEqual([
    { name: "Island", quantity: 60 },
  ]);
  await expect(
    player.mutation(api.tournaments.decklists.submitMyDecklist, {
      tournamentId,
      maindeck: [{ name: "Mountain", quantity: 60 }],
      sideboard: [],
    }),
  ).rejects.toThrow("Decklist submission is closed for this tournament");
  await expect(
    t
      .withIdentity(playerIdentity(2))
      .mutation(api.tournaments.decklists.submitMyDecklist, {
        tournamentId,
        maindeck: [{ name: "Mountain", quantity: 60 }],
        sideboard: [],
      }),
  ).rejects.toThrow("Decklist submission is closed for this tournament");
});

test("getMyDecklist is null for signed-out, unregistered, and cancelled callers", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedOpenTournament(t, 1);

  expect(
    await t.query(api.tournaments.decklists.getMyDecklist, { tournamentId }),
  ).toBeNull();
  expect(
    await t
      .withIdentity(playerIdentity(99))
      .query(api.tournaments.decklists.getMyDecklist, { tournamentId }),
  ).toBeNull();

  // Registered but nothing submitted yet: the editor is open and empty.
  const player = t.withIdentity(playerIdentity(1));
  expect(
    await player.query(api.tournaments.decklists.getMyDecklist, {
      tournamentId,
    }),
  ).toEqual({ decklist: null, submissionOpen: true });

  // Cancelling the entry hides the decklist surface entirely.
  await player.mutation(api.tournaments.registrations.cancelMyRegistration, {
    tournamentId,
  });
  expect(
    await player.query(api.tournaments.decklists.getMyDecklist, {
      tournamentId,
    }),
  ).toBeNull();
});

test("events that don't collect decklists refuse submissions until the flag turns on", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId } = await seedOpenTournament(t, 1, false);
  const player = t.withIdentity(playerIdentity(1));
  const boards = {
    tournamentId,
    maindeck: [{ name: "Island", quantity: 60 }],
    sideboard: [],
  };

  await expect(
    player.mutation(api.tournaments.decklists.submitMyDecklist, boards),
  ).rejects.toThrow("This tournament does not collect decklists");
  expect(
    await player.query(api.tournaments.decklists.getMyDecklist, {
      tournamentId,
    }),
  ).toEqual({ decklist: null, submissionOpen: false });

  // The organizer flips the flag pre-start and the editor opens.
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.updateTournamentSetup, {
      tournamentId,
      decklistRequired: true,
    });
  await player.mutation(api.tournaments.decklists.submitMyDecklist, boards);
  const result = await player.query(api.tournaments.decklists.getMyDecklist, {
    tournamentId,
  });
  expect(result?.decklist?.maindeck).toEqual([
    { name: "Island", quantity: 60 },
  ]);
});

test("a list surviving cancel → rename → re-register carries no stale name copy", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId, registrationIds } = await seedOpenTournament(t, 1);

  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.decklists.submitMyDecklist, {
      tournamentId,
      maindeck: [{ name: "Island", quantity: 60 }],
      sideboard: [],
    });
  await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.registrations.cancelMyRegistration, {
      tournamentId,
    });

  // The player renames their profile, then re-registers: registerSelf reuses
  // the cancelled row (keeping the decklist alive) and rewrites its
  // playerName from the fresh identity.
  const renamed = t.withIdentity({
    ...playerIdentity(1),
    name: "Player One Renamed",
  });
  await renamed.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId,
  });

  const registration = await t.run(
    async (ctx) => await ctx.db.get(registrationIds[0]),
  );
  expect(registration?.playerName).toBe("Player One Renamed");

  // The surviving decklist row stores no name of its own — the field a
  // stale snapshot used to live in must not reappear.
  const decklistRow = await t.run(
    async (ctx) =>
      await ctx.db
        .query("tournamentDecklists")
        .withIndex("by_registrationId", (q) =>
          q.eq("registrationId", registrationIds[0]),
        )
        .unique(),
  );
  expect(decklistRow).not.toBeNull();
  expect(decklistRow !== null && "playerName" in decklistRow).toBe(false);

  // The organizer deck-check surface still serves the surviving list; any
  // name it displays comes from the roster row, which is fresh by the
  // assertion above, so it can never disagree with the roster.
  const result = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.decklists.getDecklistForRegistration, {
      registrationId: registrationIds[0],
    });
  expect(result.decklist?.maindeck).toEqual([{ name: "Island", quantity: 60 }]);
  expect(result.submissionOpen).toBe(true);
});

test("getDecklistForRegistration serves organizers and rejects everyone else", async () => {
  const t = convexTest(schema, modules);
  const { tournamentId, registrationIds } = await seedOpenTournament(t, 2);

  const decklistId = await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.decklists.submitMyDecklist, {
      tournamentId,
      deckName: "Burn",
      maindeck: [{ name: "Lightning Bolt", quantity: 4 }],
      sideboard: [],
    });

  const result = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.decklists.getDecklistForRegistration, {
      registrationId: registrationIds[0],
    });
  expect(result.decklist?._id).toBe(decklistId);
  expect(result.decklist?.deckName).toBe("Burn");
  expect(result.submissionOpen).toBe(true);

  // A registration with nothing submitted reads as an open, empty editor.
  const empty = await t
    .withIdentity(organizerIdentity)
    .query(api.tournaments.decklists.getDecklistForRegistration, {
      registrationId: registrationIds[1],
    });
  expect(empty).toEqual({ decklist: null, submissionOpen: true });

  // Players — including the list's owner — are not tournament staff.
  await expect(
    t
      .withIdentity(playerIdentity(1))
      .query(api.tournaments.decklists.getDecklistForRegistration, {
        registrationId: registrationIds[0],
      }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    t.query(api.tournaments.decklists.getDecklistForRegistration, {
      registrationId: registrationIds[0],
    }),
  ).rejects.toThrow("Not authenticated");
});
