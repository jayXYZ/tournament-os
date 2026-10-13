/// <reference types="vite/client" />

// Join codes (see CONTEXT.md "Public Code" and "Invite Link", model/codes.ts):
// the two kinds of code a /join/<code> URL carries. The suite pins the shared
// normalizer, that the two kinds never overlap, that minting never reuses a
// code an event already holds, and resolveJoinCode's public-code branch — who
// it resolves for and when it says nothing. inviteLinks.convex.spec.ts covers
// the invite-code branch.
import type { TestConvex } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";

import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mintUniqueCode, normalizeCode } from "./model/codes";
import { INVITE_CODE_LENGTH, normalizeInviteCode } from "./model/invites";
import {
  PUBLIC_CODE_LENGTH,
  mintUniquePublicCode,
  parsePublicCode,
} from "./model/publicCodes";
import type schema from "./schema";
import {
  PUBLIC_CODE_SHAPE,
  organizerIdentity,
  playerIdentity,
  seedOrganizer,
} from "./specHelpers";
import { createConvexTest } from "./specHelpers.runtime";

test.each([
  // Canonical input passes through.
  ["7K3M9Q", 6, "7K3M9Q"],
  // What a person plausibly types: lowercase, separators, padding.
  ["7k3m9q", 6, "7K3M9Q"],
  [" 7K3-M9Q ", 6, "7K3M9Q"],
  ["7K3 M9Q", 6, "7K3M9Q"],
  // The lookalikes the alphabet excludes map onto the digits they resemble.
  ["OIL000", 6, "011000"],
  ["oil000", 6, "011000"],
  // U is excluded but resembles nothing, and other punctuation isn't a
  // separator.
  ["7K3M9U", 6, null],
  ["7K3M9_", 6, null],
  // The wrong length is malformed whatever the characters.
  ["7K3M9", 6, null],
  ["7K3M9QX", 6, null],
  ["", 6, null],
  ["ABCDE-FGHJK", 10, "ABCDEFGHJK"],
  ["abcde fghjk", 10, "ABCDEFGHJK"],
  ["7K3M9Q", 10, null],
  ["ABCDEFGHJK", 6, null],
] as const)("normalizeCode(%j, %i) is %j", (raw, length, expected) => {
  expect(normalizeCode(raw, length)).toBe(expected);
});

test("a code is a public code or an invite code, never both", () => {
  expect(PUBLIC_CODE_LENGTH).not.toBe(INVITE_CODE_LENGTH);
  expect(parsePublicCode("7K3M9Q")).toBe("7K3M9Q");
  expect(normalizeInviteCode("7K3M9Q")).toBeNull();
  expect(normalizeInviteCode("ABCDE-FGHJK")).toBe("ABCDEFGHJK");
  expect(parsePublicCode("ABCDE-FGHJK")).toBeNull();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("minting draws again while a code is taken and gives up after five draws", async () => {
  const drawn: string[] = [];
  const takenOnce = async (code: string) => {
    drawn.push(code);
    return drawn.length === 1;
  };
  const code = await mintUniqueCode(PUBLIC_CODE_LENGTH, takenOnce);
  expect(drawn).toHaveLength(2);
  expect(code).toBe(drawn[1]);

  let draws = 0;
  await expect(
    mintUniqueCode(PUBLIC_CODE_LENGTH, async () => {
      draws += 1;
      return true;
    }),
  ).rejects.toThrow("Could not generate a unique code");
  expect(draws).toBe(5);
});

test("a minted public code skips one its table already holds", async () => {
  const t = createConvexTest();
  const { organizationId, userId } = await seedOrganizer(t);
  // Each draw fills generateCode's bytes with one value, so draws of 10, 11,
  // and 12 produce AAAAAA, BBBBBB, and CCCCCC.
  const drawBytes = (...values: number[]) => {
    let call = 0;
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
      new Uint8Array(array.buffer).fill(values[call++]);
      return array;
    });
  };

  const minted = await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("tournaments", {
      name: "Holds AAAAAA",
      publicCode: "AAAAAA",
      organizationId,
      createdBy: userId,
      visibility: "public",
      lifecycle: "registration",
      startDate: now,
      playerCapacity: 8,
      format: "standard",
      isTestEvent: false,
      autoPublishPairings: false,
      decklistRequired: false,
      registrationRequiresApproval: false,
      confirmedRegistrationCount: 0,
      seed: 1,
      updatedAt: now,
    });
    await ctx.db.insert("conventions", {
      name: "Holds BBBBBB",
      publicCode: "BBBBBB",
      organizationId,
      createdBy: userId,
      visibility: "public",
      lifecycle: "registration",
      startDate: now,
      endDate: now,
      playerCapacity: 8,
      isTestEvent: false,
      badgeRequiredForChildEvents: false,
      confirmedRegistrationCount: 0,
      updatedAt: now,
    });

    drawBytes(10, 11);
    const tournamentCode = await mintUniquePublicCode(ctx, "tournaments");
    // Each table checks only itself: a tournament code is free to match a
    // convention's, since the two never share a route.
    drawBytes(11, 12);
    const conventionCode = await mintUniquePublicCode(ctx, "conventions");
    return { tournamentCode, conventionCode };
  });

  expect(minted).toEqual({
    tournamentCode: "BBBBBB",
    conventionCode: "CCCCCC",
  });
});

test("resolveJoinCode routes a public code to its event and tolerates lookalike typing", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t);
  const publicCode = await tournamentPublicCode(t, tournamentId);
  expect(publicCode).toMatch(PUBLIC_CODE_SHAPE);

  expect(
    await t.query(api.tournaments.invites.resolveJoinCode, {
      code: publicCode,
    }),
  ).toEqual({ publicCode });

  // A code typed off a poster comes back in canonical form, with no invite.
  const asTyped = ` ${publicCode
    .toLowerCase()
    .replace(/0/g, "o")
    .replace(/1/g, "l")
    .split("")
    .join("-")} `;
  expect(
    await t.query(api.tournaments.invites.resolveJoinCode, { code: asTyped }),
  ).toEqual({ publicCode });

  // Unlisted events need no invite: the public code is how they're reached.
  await t
    .withIdentity(organizerIdentity)
    .mutation(api.tournaments.lifecycle.updateTournamentVisibility, {
      tournamentId,
      visibility: "unlisted",
    });
  expect(
    await t.query(api.tournaments.invites.resolveJoinCode, {
      code: publicCode,
    }),
  ).toEqual({ publicCode });
});

test("a public code stops admitting strangers once its event goes private", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t);
  const publicCode = await tournamentPublicCode(t, tournamentId);

  await insertPlayerUser(t, 1);
  const player = t.withIdentity(playerIdentity(1));
  await player.mutation(api.tournaments.registrations.registerSelf, {
    tournamentId,
  });

  const organizer = t.withIdentity(organizerIdentity);
  await organizer.mutation(
    api.tournaments.lifecycle.updateTournamentVisibility,
    { tournamentId, visibility: "private" },
  );

  // Going private is how a public poster is revoked: to a stranger the code
  // now reads exactly like one that never existed.
  expect(
    await t.query(api.tournaments.invites.resolveJoinCode, {
      code: publicCode,
    }),
  ).toBeNull();
  await insertPlayerUser(t, 2);
  expect(
    await t
      .withIdentity(playerIdentity(2))
      .query(api.tournaments.invites.resolveJoinCode, { code: publicCode }),
  ).toBeNull();

  // Whoever could still open the event page still gets there: the
  // registered player and the organizing team.
  expect(
    await player.query(api.tournaments.invites.resolveJoinCode, {
      code: publicCode,
    }),
  ).toEqual({ publicCode });
  expect(
    await organizer.query(api.tournaments.invites.resolveJoinCode, {
      code: publicCode,
    }),
  ).toEqual({ publicCode });
});

test("a public code opens nothing before publication, even for the organizer", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t, { publish: false });
  const publicCode = await tournamentPublicCode(t, tournamentId);

  // A QR code printed during setup would scan as broken, so the join URL
  // treats setup like an unknown code for everyone; the organizer still
  // previews the event through its page.
  for (const viewer of [t, t.withIdentity(organizerIdentity)]) {
    expect(
      await viewer.query(api.tournaments.invites.resolveJoinCode, {
        code: publicCode,
      }),
    ).toBeNull();
  }
  expect(
    await t
      .withIdentity(organizerIdentity)
      .query(api.tournaments.lifecycle.getPublicTournament, { publicCode }),
  ).toMatchObject({ tournament: { _id: tournamentId } });
});

test("unknown and malformed codes of either kind resolve to nothing", async () => {
  const t = createConvexTest();
  const { tournamentId } = await seedTournament(t);
  const publicCode = await tournamentPublicCode(t, tournamentId);
  // A well-formed code no event holds: the live code with its first
  // character swapped for another alphabet character.
  const unknownPublicCode = `${publicCode[0] === "Z" ? "Y" : "Z"}${publicCode.slice(1)}`;

  for (const code of [
    unknownPublicCode,
    "0000000000",
    "not a code",
    "",
    `${publicCode}X`,
  ]) {
    expect(
      await t.query(api.tournaments.invites.resolveJoinCode, { code }),
    ).toBeNull();
  }
  expect(
    await t.query(api.tournaments.lifecycle.getPublicTournament, {
      publicCode: unknownPublicCode,
    }),
  ).toBeNull();
});

async function seedTournament(
  t: TestConvex<typeof schema>,
  options: { publish?: boolean } = {},
) {
  const { organizationId } = await seedOrganizer(t, 1000);
  const organizer = t.withIdentity(organizerIdentity);
  const tournamentId: Id<"tournaments"> = await organizer.mutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
    {
      organizationId,
      name: "Join Code Event",
      startDate: Date.now() + 86_400_000,
      playerCapacity: 8,
      format: "standard",
      phases: [{ phaseOrder: 1, phaseRoundMode: "dynamic" }],
    },
  );
  if (options.publish ?? true) {
    await organizer.mutation(api.tournaments.lifecycle.publishTournament, {
      tournamentId,
    });
  }
  return { tournamentId, organizationId };
}

async function tournamentPublicCode(
  t: TestConvex<typeof schema>,
  tournamentId: Id<"tournaments">,
): Promise<string> {
  const tournament = await t.run(async (ctx) => await ctx.db.get(tournamentId));
  if (!tournament) {
    throw new Error("Tournament not found");
  }
  return tournament.publicCode;
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
