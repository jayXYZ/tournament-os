/// <reference types="vite/client" />

// Invite links (see CONTEXT.md "Invite Link" and model/invites.ts): the
// organizer-managed join code that lets a new player view and register for a
// private event. The suite pins the grant's whole boundary — what the code
// opens (the event page, registerSelf), what it never overrides (entry
// decisions, capacity, lifecycle, setup secrecy), and how the code's own
// lifecycle behaves (rotation kills old links, disabling kills the link,
// admitted players survive both).
import type { TestConvex } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { organizerIdentity, seedOrganizer } from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

test("an invite code lets a new player see and join a private event", async () => {
  const t = createConvexTest();
  const { tournamentId, publicCode } = await seedPrivateTournament(t);
  const code = await regenerateInviteLink(t, tournamentId);

  // Without the code the event stays invisible and closed to a stranger.
  await insertPlayerUser(t, 1);
  const player = t.withIdentity(playerIdentity(1));
  expect(
    await player.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode,
    }),
  ).toBeNull();
  await expect(
    player.mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
    }),
  ).rejects.toThrow("Tournament is not open for registration");

  // With it, the page resolves — even signed out — and registration lands a
  // confirmed seat like any open event.
  expect(
    await t.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode,
      inviteCode: code,
    }),
  ).toMatchObject({ tournament: { _id: tournamentId } });
  const registrationId = await player.mutation(
    api.tournaments.registrations.registerSelf,
    { tournamentId, inviteCode: code },
  );
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
  });

  // A wrong code grants nothing.
  expect(
    await t.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode,
      inviteCode: "0000000000",
    }),
  ).toBeNull();
});

test("under approval mode an invited player files a pending application", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedPrivateTournament(t);
  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.lifecycle.updateTournamentSetup, {
    tournamentId,
    registrationRequiresApproval: true,
  });
  const code = await regenerateInviteLink(t, tournamentId);

  await insertPlayerUser(t, 1);
  const registrationId = await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
      inviteCode: code,
    });
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "pending",
  });
});

test("resolveInviteCode routes a code to its event and tolerates lookalike typing", async () => {
  const t = createConvexTest();
  const { tournamentId, publicCode } = await seedPrivateTournament(t);
  const code = await regenerateInviteLink(t, tournamentId);

  expect(
    await t.query(api.tournaments.invites.resolveInviteCode, {
      inviteCode: code,
    }),
  ).toEqual({ publicCode, inviteCode: code });

  // Normalization maps what a person plausibly types — lowercase, separators,
  // and the lookalikes the alphabet excludes (O for 0, I/L for 1) — back onto
  // the canonical code, and returns that canonical form for the redirect.
  const asTyped = ` ${code
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "l")
    .split("")
    .join("-")} `;
  expect(
    await t.query(api.tournaments.invites.resolveInviteCode, {
      inviteCode: asTyped,
    }),
  ).toEqual({ publicCode, inviteCode: code });

  // Unknown and malformed codes resolve to nothing, identically.
  expect(
    await t.query(api.tournaments.invites.resolveInviteCode, {
      inviteCode: "0000000000",
    }),
  ).toBeNull();
  expect(
    await t.query(api.tournaments.invites.resolveInviteCode, {
      inviteCode: "not a code",
    }),
  ).toBeNull();
});

test("rotating replaces the code and disabling ends the link; admitted players survive both", async () => {
  const t = createConvexTest();
  const { tournamentId, publicCode } = await seedPrivateTournament(t);
  const firstCode = await regenerateInviteLink(t, tournamentId);

  await insertPlayerUser(t, 1);
  const registrationId = await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
      inviteCode: firstCode,
    });

  const secondCode = await regenerateInviteLink(t, tournamentId);
  expect(secondCode).not.toBe(firstCode);
  // Every previously shared link died with the rotation.
  expect(
    await t.query(api.tournaments.invites.resolveInviteCode, {
      inviteCode: firstCode,
    }),
  ).toBeNull();
  expect(
    await t.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode,
      inviteCode: firstCode,
    }),
  ).toBeNull();
  expect(
    await t.query(api.tournaments.invites.resolveInviteCode, {
      inviteCode: secondCode,
    }),
  ).not.toBeNull();

  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(api.tournaments.invites.disableInviteLink, {
    tournamentId,
  });
  expect(
    await organizer.query(api.tournaments.invites.getInviteLink, {
      tournamentId,
    }),
  ).toBeNull();
  expect(
    await t.query(api.tournaments.invites.resolveInviteCode, {
      inviteCode: secondCode,
    }),
  ).toBeNull();
  await expect(
    t
      .withIdentity(playerIdentity(2))
      .mutation(api.tournaments.registrations.registerSelf, {
        tournamentId,
        inviteCode: secondCode,
      }),
  ).rejects.toThrow("Tournament is not open for registration");

  // The player the link admitted holds their seat: the link is an entry
  // door, not a membership.
  expect(await getRegistration(t, registrationId)).toMatchObject({
    entryStatus: "confirmed",
    participationStatus: "active",
  });
});

test("invite management is organizer-only and the code never reaches player queries", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedPrivateTournament(t);
  await regenerateInviteLink(t, tournamentId);

  await insertPlayerUser(t, 1);
  const player = t.withIdentity(playerIdentity(1));
  await expect(
    player.mutation(api.tournaments.invites.regenerateInviteLink, {
      tournamentId,
    }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    player.mutation(api.tournaments.invites.disableInviteLink, {
      tournamentId,
    }),
  ).rejects.toThrow("Unauthorized");
  await expect(
    player.query(api.tournaments.invites.getInviteLink, { tournamentId }),
  ).rejects.toThrow("Unauthorized");
});

test("an invite code never reveals an unpublished event", async () => {
  const t = createConvexTest();
  const { organizationId } = await seedOrganizer(t, 1000);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Invite Link Event",
      startDate: Date.now(),
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  // Minting the link during setup is allowed — organizers prepare the share
  // link before publishing — but the code opens nothing until publication.
  const code = await regenerateInviteLink(t, tournamentId);
  const publicCode = await tournamentPublicCode(t, tournamentId);

  expect(
    await t.query(api.tournaments.invites.resolveInviteCode, {
      inviteCode: code,
    }),
  ).toBeNull();
  expect(
    await t.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode,
      inviteCode: code,
    }),
  ).toBeNull();

  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  expect(
    await t.query(api.tournaments.invites.resolveInviteCode, {
      inviteCode: code,
    }),
  ).toEqual({ publicCode, inviteCode: code });
});

test("an invite code never overrides entry decisions or capacity", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedPrivateTournament(t, {
    playerCapacity: 2,
  });
  const code = await regenerateInviteLink(t, tournamentId);
  const organizer = t.withIdentity(organizerIdentity);

  // A rejection sticks: the code grants entry to strangers, not a reversal
  // of the organizer's decision (that stays approveEntry's job).
  await insertPlayerUser(t, 1);
  const rejectedId = await t
    .withIdentity(playerIdentity(1))
    .mutation(api.tournaments.registrations.registerSelf, {
      tournamentId,
      inviteCode: code,
    });
  await organizer.mutation(api.tournaments.registrations.rejectRegistration, {
    registrationId: rejectedId,
  });
  await expect(
    t
      .withIdentity(playerIdentity(1))
      .mutation(api.tournaments.registrations.registerSelf, {
        tournamentId,
        inviteCode: code,
      }),
  ).rejects.toThrow("Your registration was declined");

  // Capacity still gates invited registrations.
  await insertPlayerUser(t, 2);
  await insertPlayerUser(t, 3);
  await insertPlayerUser(t, 4);
  for (const playerNumber of [2, 3]) {
    await t
      .withIdentity(playerIdentity(playerNumber))
      .mutation(api.tournaments.registrations.registerSelf, {
        tournamentId,
        inviteCode: code,
      });
  }
  await expect(
    t
      .withIdentity(playerIdentity(4))
      .mutation(api.tournaments.registrations.registerSelf, {
        tournamentId,
        inviteCode: code,
      }),
  ).rejects.toThrow("Tournament is at capacity");
});

function playerIdentity(playerNumber: number) {
  return {
    issuer: "https://convex.test",
    subject: `player-${playerNumber}`,
    tokenIdentifier: `https://convex.test|player-${playerNumber}`,
    email: `player${playerNumber}@example.test`,
    name: `Player ${playerNumber}`,
  };
}

// A published private tournament in the "registration" lifecycle — the shape
// invite links exist for: without a code, no new player can see or join it.
async function seedPrivateTournament(
  t: TestConvex<typeof schema>,
  options: { playerCapacity?: number } = {},
) {
  const { organizationId } = await seedOrganizer(t, 1000);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Invite Link Event",
      startDate: Date.now(),
      playerCapacity: options.playerCapacity ?? 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
    tournamentId,
  });
  await organizer.mutation(
    api.tournaments.lifecycle.updateTournamentVisibility,
    {
      tournamentId,
      visibility: "private",
    },
  );
  return {
    tournamentId,
    organizationId,
    publicCode: await tournamentPublicCode(t, tournamentId),
  };
}

async function regenerateInviteLink(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
): Promise<string> {
  return await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.invites.regenerateInviteLink, { tournamentId });
}

async function tournamentPublicCode(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
): Promise<string> {
  const tournament = await t.run(async (ctx) => await ctx.db.get(tournamentId));
  if (!tournament) {
    throw new Error("Tournament not found");
  }
  return String(tournament.publicCode);
}

async function insertPlayerUser(
  t: TestConvex<typeof schema>,
  playerNumber: number,
): Promise<Id<"users">> {
  const identity = playerIdentity(playerNumber);
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      publicCode: playerNumber,
      email: identity.email,
      name: identity.name,
      updatedAt: Date.now(),
    });
  });
}

async function getRegistration(
  t: TestConvex<typeof schema>,
  registrationId: Id<"tournamentRegistrations">,
) {
  return await t.run(async (ctx) => await ctx.db.get(registrationId));
}
