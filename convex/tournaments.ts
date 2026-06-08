import { v } from "convex/values";

import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { identityWorkosUserId, requireIdentity } from "./auth";
import {
  BYE_MATCH_POINTS,
  SWISS_FORMAT,
  compareStandingRows,
  createSeededRandom,
  defaultSwissRoundCount,
  matchPointsForResult,
  simulatedMatchResult,
} from "./tournamentUtils";
import { tournamentPhaseRoundModeValidator } from "./validators";

type TournamentCtx = QueryCtx | MutationCtx;
type PhaseRoundMode = "dynamic" | "fixed";
type TournamentAccess = {
  tournament: Doc<"tournaments">;
  user: Doc<"users">;
  membership: Doc<"organizationMemberships">;
};
type TournamentPhaseInput = {
  phaseOrder: number;
  phaseRoundMode: PhaseRoundMode;
  phaseTotalRounds?: number;
};
type RankedRegistration = {
  registration: Doc<"tournamentRegistrations">;
  matchPoints: number;
  opponentMatchWinPct: number;
  gameWinPct: number;
  opponentGameWinPct: number;
  createdAt: number;
};
type Pairing = {
  playerOne: Doc<"tournamentRegistrations">;
  playerTwo?: Doc<"tournamentRegistrations">;
  isBye: boolean;
};
type PlayerStats = {
  registration: Doc<"tournamentRegistrations">;
  matchPoints: number;
  matchWins: number;
  matchLosses: number;
  matchDraws: number;
  gameWins: number;
  gameLosses: number;
  opponentIds: Id<"tournamentRegistrations">[];
  createdAt: number;
};

export const listForOrganization = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOrganizationMembership(ctx, args.organizationId);

    return await ctx.db
      .query("tournaments")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", args.organizationId),
      )
      .order("desc")
      .take(100);
  },
});

export const listUpcomingPublic = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("tournaments")
      .withIndex("by_status_and_startDate", (q) =>
        q.eq("status", "public").gte("startDate", Date.now()),
      )
      .order("asc")
      .take(100);
  },
});

export const listUpcomingForOrganization = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireOrganizationMembership(ctx, args.organizationId);

    const now = Date.now();
    const rows = [];
    for (const status of ["private", "public", "in_progress"] as const) {
      const tournaments = await ctx.db
        .query("tournaments")
        .withIndex("by_organizationId_and_status_and_startDate", (q) =>
          q
            .eq("organizationId", args.organizationId)
            .eq("status", status)
            .gte("startDate", now),
        )
        .order("asc")
        .take(100);
      rows.push(...tournaments);
    }

    rows.sort((left, right) => left.startDate - right.startDate);
    return rows.slice(0, 100);
  },
});

export const getTournamentSetup = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const phases = await ctx.db
      .query("tournamentPhases")
      .withIndex("by_tournamentId_and_phaseOrder", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .take(16);
    const testConfig = await ctx.db
      .query("tournamentTestConfigs")
      .withIndex("by_tournamentId", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .unique();

    return { tournament, phases, testConfig };
  },
});

export const createTournament = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    startDate: v.number(),
    playerCapacity: v.number(),
  },
  handler: async (ctx, args): Promise<Id<"tournaments">> => {
    return await createTournamentInternal(ctx, {
      organizationId: args.organizationId,
      name: args.name,
      startDate: args.startDate,
      isTestEvent: false,
      playerCapacity: args.playerCapacity,
      phases: validPhaseInputs([
        { phaseOrder: 1, phaseRoundMode: "dynamic" },
      ]),
    });
  },
});

export const createTournamentWithPhases = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    startDate: v.number(),
    playerCapacity: v.number(),
    isTestEvent: v.optional(v.boolean()),
    phases: v.array(
      v.object({
        phaseOrder: v.number(),
        phaseRoundMode: tournamentPhaseRoundModeValidator,
        phaseTotalRounds: v.optional(v.number()),
      }),
    ),
  },
  handler: async (ctx, args): Promise<Id<"tournaments">> => {
    return await createTournamentInternal(ctx, {
      organizationId: args.organizationId,
      name: args.name,
      startDate: args.startDate,
      playerCapacity: args.playerCapacity,
      isTestEvent: args.isTestEvent ?? false,
      phases: validPhaseInputs(args.phases),
    });
  },
});

export const updateTournamentSetup = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.optional(v.string()),
    startDate: v.optional(v.number()),
    playerCapacity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireSetupEditable(tournament);

    const patch: Partial<Doc<"tournaments">> = { updatedAt: Date.now() };
    if (args.name !== undefined) {
      patch.name = cleanName(args.name, "Tournament name");
    }
    if (args.startDate !== undefined) {
      patch.startDate = args.startDate;
    }
    if (args.playerCapacity !== undefined) {
      patch.playerCapacity = validCapacity(args.playerCapacity);
    }

    await ctx.db.patch(args.tournamentId, patch);
    return args.tournamentId;
  },
});

export const configureSwissPhase = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    phaseTotalRounds: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"tournamentPhases">> => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireSetupEditable(tournament);
    const now = Date.now();
    const phaseTotalRounds = validRoundCount(
      args.phaseTotalRounds ?? defaultSwissRoundCount(tournament.playerCapacity),
    );
    const existing = await ctx.db
      .query("tournamentPhases")
      .withIndex("by_tournamentId_and_phaseOrder", (q) =>
        q.eq("tournamentId", args.tournamentId).eq("phaseOrder", 1),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        phaseType: SWISS_FORMAT,
        phaseStatus: "upcoming",
        phaseRoundMode: "fixed",
        phaseTotalRounds,
        phaseCutoff: null,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("tournamentPhases", {
      tournamentId: args.tournamentId,
      phaseType: SWISS_FORMAT,
      phaseOrder: 1,
      phaseStatus: "upcoming",
      phaseRoundMode: "fixed",
      phaseTotalRounds,
      phaseCutoff: null,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const publishTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireSetupEditable(tournament);
    await requireSwissPhase(ctx, args.tournamentId);

    await ctx.db.patch(args.tournamentId, {
      status: "public",
      updatedAt: Date.now(),
    });
    return args.tournamentId;
  },
});

export const cancelTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireOrganizerAccess(ctx, args.tournamentId);
    await ctx.db.patch(args.tournamentId, {
      status: "cancelled",
      updatedAt: Date.now(),
    });
    return args.tournamentId;
  },
});

export const registerSelf = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournamentRegistrations">> => {
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    if (tournament.status !== "public") {
      throw new Error("Tournament is not open for registration");
    }

    const existing = await registrationForUser(ctx, args.tournamentId, user._id);
    if (existing && existing.status !== "dropped") {
      throw new Error("Already registered");
    }

    await requireCapacityAvailable(ctx, tournament);
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { status: "active", updatedAt: now });
      return existing._id;
    }

    return await ctx.db.insert("tournamentRegistrations", {
      tournamentId: args.tournamentId,
      userId: user._id,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const cancelMyRegistration = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    requireSetupEditable(tournament);
    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (!registration || registration.status !== "active") {
      throw new Error("Active registration not found");
    }

    await ctx.db.patch(registration._id, {
      status: "dropped",
      updatedAt: Date.now(),
    });
    return registration._id;
  },
});

export const getMyRegistration = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const user = await currentUserOrNull(ctx);
    if (!user) {
      return null;
    }

    return await registrationForUser(ctx, args.tournamentId, user._id);
  },
});

export const listRegistrations = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await requireOrganizerAccess(ctx, args.tournamentId);
    const registrations = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .take(512);

    const rows = [];
    for (const registration of registrations) {
      rows.push({
        registration,
        user: await ctx.db.get(registration.userId),
      });
    }

    return rows;
  },
});

export const dropRegistration = mutation({
  args: { registrationId: v.id("tournamentRegistrations") },
  handler: async (ctx, args) => {
    const registration = await requireRegistration(ctx, args.registrationId);
    await requireOrganizerAccess(ctx, registration.tournamentId);
    await ctx.db.patch(args.registrationId, {
      status: "dropped",
      updatedAt: Date.now(),
    });
    return args.registrationId;
  },
});

export const reinstateRegistration = mutation({
  args: { registrationId: v.id("tournamentRegistrations") },
  handler: async (ctx, args) => {
    const registration = await requireRegistration(ctx, args.registrationId);
    const { tournament } = await requireOrganizerAccess(
      ctx,
      registration.tournamentId,
    );
    await requireCapacityAvailable(ctx, tournament);
    await ctx.db.patch(args.registrationId, {
      status: "active",
      updatedAt: Date.now(),
    });
    return args.registrationId;
  },
});

export const startTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournamentRounds">> => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireSetupEditable(tournament);
    const phase = await requireSwissPhase(ctx, args.tournamentId);
    const registrations = await activeRegistrations(ctx, args.tournamentId);
    if (registrations.length < 2) {
      throw new Error("At least two active players are required");
    }
    const phaseTotalRounds = await resolvePhaseTotalRounds(
      ctx,
      phase,
      registrations.length,
    );
    const playablePhase = { ...phase, phaseTotalRounds };

    const roundId = await createRoundWithPairings(ctx, {
      tournament,
      phase: playablePhase,
      roundNumber: 1,
      registrations,
    });
    const now = Date.now();
    await ctx.db.patch(tournament._id, { status: "in_progress", updatedAt: now });
    await ctx.db.patch(playablePhase._id, {
      phaseStatus: "in_progress",
      phaseCurrentRound: roundId,
      updatedAt: now,
    });

    return roundId;
  },
});

export const generateNextRound = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournamentRounds">> => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const phase = await requireSwissPhase(ctx, args.tournamentId);
    if (tournament.status !== "in_progress") {
      throw new Error("Tournament is not in progress");
    }
    if (!phase.phaseCurrentRound) {
      throw new Error("Current round not found");
    }

    const currentRound = await requireRound(ctx, phase.phaseCurrentRound);
    if (currentRound.roundStatus !== "completed") {
      throw new Error("Current round must be completed first");
    }
    const phaseTotalRounds = requireResolvedPhaseTotalRounds(phase);
    if (currentRound.roundNumber >= phaseTotalRounds) {
      throw new Error("All configured rounds have been generated");
    }

    const roundId = await createRoundWithPairings(ctx, {
      tournament,
      phase,
      roundNumber: currentRound.roundNumber + 1,
      registrations: await activeRegistrations(ctx, args.tournamentId),
      previousRoundId: currentRound._id,
    });
    await ctx.db.patch(phase._id, {
      phaseCurrentRound: roundId,
      updatedAt: Date.now(),
    });
    return roundId;
  },
});

export const recordMatchResult = mutation({
  args: {
    matchId: v.id("tournamentMatches"),
    playerOneRegistrationId: v.id("tournamentRegistrations"),
    playerTwoRegistrationId: v.id("tournamentRegistrations"),
    playerOneGameWins: v.number(),
    playerTwoGameWins: v.number(),
  },
  handler: async (ctx, args) => {
    const match = await requireMatch(ctx, args.matchId);
    await requireOrganizerAccess(ctx, match.tournamentId);
    const players = await matchPlayers(ctx, args.matchId);
    if (players.length !== 2) {
      throw new Error("Match result requires exactly two players");
    }

    const playerOne = players.find(
      (player) => player.playerId === args.playerOneRegistrationId,
    );
    const playerTwo = players.find(
      (player) => player.playerId === args.playerTwoRegistrationId,
    );
    if (!playerOne || !playerTwo) {
      throw new Error("Result players must match the pairing");
    }

    const [playerOnePoints, playerTwoPoints] = matchPointsForResult({
      playerOneGameWins: args.playerOneGameWins,
      playerTwoGameWins: args.playerTwoGameWins,
    });
    const now = Date.now();
    await ctx.db.patch(playerOne._id, {
      matchPointsEarned: playerOnePoints,
      gameWins: args.playerOneGameWins,
      gameLosses: args.playerTwoGameWins,
      updatedAt: now,
    });
    await ctx.db.patch(playerTwo._id, {
      matchPointsEarned: playerTwoPoints,
      gameWins: args.playerTwoGameWins,
      gameLosses: args.playerOneGameWins,
      updatedAt: now,
    });
    await ctx.db.patch(args.matchId, {
      matchStatus: "completed",
      updatedAt: now,
    });
    return args.matchId;
  },
});

export const completeRound = mutation({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    const { tournament } = await requireOrganizerAccess(ctx, round.tournamentId);
    const phase = await requireSwissPhase(ctx, round.tournamentId);
    const matches = await roundMatches(ctx, args.roundId);
    for (const match of matches) {
      if (match.matchStatus !== "completed" && match.matchStatus !== "confirmed") {
        throw new Error("All matches need results before completing the round");
      }
    }

    await replaceStandingsForRound(ctx, tournament, phase, round);
    const now = Date.now();
    await ctx.db.patch(args.roundId, {
      roundStatus: "completed",
      updatedAt: now,
    });
    const phaseTotalRounds = requireResolvedPhaseTotalRounds(phase);
    if (round.roundNumber >= phaseTotalRounds) {
      await ctx.db.patch(phase._id, {
        phaseStatus: "completed",
        updatedAt: now,
      });
    }
    return args.roundId;
  },
});

export const getCurrentRound = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const phase = await requireSwissPhase(ctx, tournament._id);
    if (!phase.phaseCurrentRound) {
      return null;
    }

    return await ctx.db.get(phase.phaseCurrentRound);
  },
});

export const listRoundPairings = query({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    await requireOrganizerAccess(ctx, round.tournamentId);
    const matches = await roundMatches(ctx, args.roundId);
    const rows = [];

    for (const match of matches) {
      const players = await matchPlayers(ctx, match._id);
      rows.push({ match, players });
    }

    return rows;
  },
});

export const getStandings = query({
  args: { roundId: v.id("tournamentRounds") },
  handler: async (ctx, args) => {
    const round = await requireRound(ctx, args.roundId);
    await requireOrganizerAccess(ctx, round.tournamentId);
    return await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_rank", (q) =>
        q.eq("tournamentRoundId", args.roundId),
      )
      .take(512);
  },
});

export const completeTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await completeTournamentInternal(ctx, args.tournamentId);
    return args.tournamentId;
  },
});

export const createTestTournament = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.optional(v.string()),
    startDate: v.optional(v.number()),
    playerCapacity: v.optional(v.number()),
    dummyPlayerCount: v.optional(v.number()),
    roundsToGenerate: v.optional(v.number()),
    seed: v.optional(v.number()),
    autoStart: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"tournaments">> => {
    const { user } = await requireOrganizationMembership(ctx, args.organizationId);
    const dummyPlayerCount = validCapacity(args.dummyPlayerCount ?? 8);
    const playerCapacity = validCapacity(args.playerCapacity ?? dummyPlayerCount);
    if (dummyPlayerCount > playerCapacity) {
      throw new Error("Dummy player count cannot exceed capacity");
    }

    const now = Date.now();
    const roundsToGenerate = validRoundCount(
      args.roundsToGenerate ?? defaultSwissRoundCount(dummyPlayerCount),
    );
    const tournamentId = await ctx.db.insert("tournaments", {
      name: cleanName(args.name ?? "Test Tournament", "Tournament name"),
      organizationId: args.organizationId,
      createdBy: user._id,
      status: "private",
      startDate: args.startDate ?? now,
      playerCapacity,
      format: SWISS_FORMAT,
      isTestEvent: true,
      createdAt: now,
      updatedAt: now,
    });

    const phaseId = await ctx.db.insert("tournamentPhases", {
      tournamentId,
      phaseType: SWISS_FORMAT,
      phaseOrder: 1,
      phaseStatus: "upcoming",
      phaseRoundMode: "fixed",
      phaseTotalRounds: roundsToGenerate,
      phaseCutoff: null,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentTestConfigs", {
      tournamentId,
      dummyPlayerCount,
      roundsToGenerate,
      seed: Math.trunc(args.seed ?? now),
      createdAt: now,
      updatedAt: now,
    });

    await seedTestPlayersInternal(ctx, tournamentId, dummyPlayerCount);

    if (args.autoStart === true) {
      const tournament = await requireTournament(ctx, tournamentId);
      const phase = await requirePhase(ctx, phaseId);
      const roundId = await createRoundWithPairings(ctx, {
        tournament,
        phase,
        roundNumber: 1,
        registrations: await activeRegistrations(ctx, tournamentId),
      });
      await ctx.db.patch(tournamentId, { status: "in_progress", updatedAt: now });
      await ctx.db.patch(phaseId, {
        phaseStatus: "in_progress",
        phaseCurrentRound: roundId,
        updatedAt: now,
      });
    }

    return tournamentId;
  },
});

export const seedTestPlayers = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    count: v.number(),
  },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireTestTournament(tournament);
    await seedTestPlayersInternal(ctx, args.tournamentId, args.count);
    return args.tournamentId;
  },
});

export const generateTestRoundResults = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    roundId: v.optional(v.id("tournamentRounds")),
  },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireTestTournament(tournament);
    const phase = await requireSwissPhase(ctx, args.tournamentId);
    const roundId = args.roundId ?? phase.phaseCurrentRound;
    if (!roundId) {
      throw new Error("Current round not found");
    }

    await generateTestResultsInternal(ctx, tournament, await requireRound(ctx, roundId));
    return roundId;
  },
});

export const advanceTestRound = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireTestTournament(tournament);
    const phase = await requireSwissPhase(ctx, args.tournamentId);
    if (!phase.phaseCurrentRound) {
      throw new Error("Current round not found");
    }

    const round = await requireRound(ctx, phase.phaseCurrentRound);
    await generateTestResultsInternal(ctx, tournament, round);
    await replaceStandingsForRound(ctx, tournament, phase, round);
    await ctx.db.patch(round._id, {
      roundStatus: "completed",
      updatedAt: Date.now(),
    });

    const config = await requireTestConfig(ctx, args.tournamentId);
    const finalRound = Math.min(
      config.roundsToGenerate,
      requireResolvedPhaseTotalRounds(phase),
    );
    if (round.roundNumber >= finalRound) {
      await completeTournamentInternal(ctx, args.tournamentId);
      return { tournamentId: args.tournamentId, roundId: round._id };
    }

    const nextRoundId = await createRoundWithPairings(ctx, {
      tournament,
      phase,
      roundNumber: round.roundNumber + 1,
      registrations: await activeRegistrations(ctx, args.tournamentId),
      previousRoundId: round._id,
    });
    await ctx.db.patch(phase._id, {
      phaseStatus: "in_progress",
      phaseCurrentRound: nextRoundId,
      updatedAt: Date.now(),
    });
    return { tournamentId: args.tournamentId, roundId: nextRoundId };
  },
});

export const resetTestTournament = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requireTestTournament(tournament);
    const config = await requireTestConfig(ctx, args.tournamentId);
    await deleteTestTournamentOperationalData(ctx, args.tournamentId);
    const now = Date.now();
    await ctx.db.patch(args.tournamentId, {
      status: "private",
      updatedAt: now,
    });
    await ctx.db.insert("tournamentPhases", {
      tournamentId: args.tournamentId,
      phaseType: SWISS_FORMAT,
      phaseOrder: 1,
      phaseStatus: "upcoming",
      phaseRoundMode: "fixed",
      phaseTotalRounds: config.roundsToGenerate,
      phaseCutoff: null,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("tournamentTestConfigs", {
      tournamentId: args.tournamentId,
      dummyPlayerCount: config.dummyPlayerCount,
      roundsToGenerate: config.roundsToGenerate,
      seed: config.seed,
      createdAt: now,
      updatedAt: now,
    });
    await seedTestPlayersInternal(ctx, args.tournamentId, config.dummyPlayerCount);
    return args.tournamentId;
  },
});

async function createTournamentInternal(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    name: string;
    startDate: number;
    playerCapacity: number;
    isTestEvent: boolean;
    phases: ReturnType<typeof validPhaseInputs>;
  },
) {
  const { user } = await requireOrganizationMembership(ctx, args.organizationId);
  const now = Date.now();
  const tournamentId = await ctx.db.insert("tournaments", {
    name: cleanName(args.name, "Tournament name"),
    organizationId: args.organizationId,
    createdBy: user._id,
    status: "private",
    startDate: args.startDate,
    playerCapacity: validCapacity(args.playerCapacity),
    format: SWISS_FORMAT,
    isTestEvent: args.isTestEvent,
    createdAt: now,
    updatedAt: now,
  });

  await createSwissPhases(ctx, tournamentId, args.phases, now);
  return tournamentId;
}

async function currentUserOrNull(ctx: TournamentCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    return null;
  }

  return await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
}

async function ensureCurrentUser(ctx: MutationCtx) {
  const identity = await requireIdentity(ctx);
  const existing = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  const now = Date.now();
  const patch = {
    workosUserId: identityWorkosUserId(identity),
    email: identity.email,
    name: identity.name,
    avatarUrl: identity.pictureUrl,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return await requireUser(ctx, existing._id);
  }

  const userId = await ctx.db.insert("users", {
    tokenIdentifier: identity.tokenIdentifier,
    ...patch,
    createdAt: now,
  });
  return await requireUser(ctx, userId);
}

async function requireUser(ctx: TournamentCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new Error("User not found");
  }
  return user;
}

async function requireOrganizationMembership(
  ctx: TournamentCtx,
  organizationId: Id<"organizations">,
) {
  const user = await ensureUserForAccess(ctx);
  const membership = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_organizationId_and_userId_and_status", (q) =>
      q.eq("organizationId", organizationId).eq("userId", user._id).eq("status", "active"),
    )
    .unique();
  if (!membership) {
    throw new Error("Unauthorized");
  }

  return { user, membership };
}

async function requireOrganizerAccess(
  ctx: TournamentCtx,
  tournamentId: Id<"tournaments">,
): Promise<TournamentAccess> {
  const tournament = await requireTournament(ctx, tournamentId);
  const { user, membership } = await requireOrganizationMembership(
    ctx,
    tournament.organizationId,
  );
  return { tournament, user, membership };
}

async function ensureUserForAccess(ctx: TournamentCtx) {
  const user = await currentUserOrNull(ctx);
  if (!user) {
    throw new Error("Not authenticated");
  }
  return user;
}

async function requireTournament(
  ctx: TournamentCtx,
  tournamentId: Id<"tournaments">,
) {
  const tournament = await ctx.db.get(tournamentId);
  if (!tournament) {
    throw new Error("Tournament not found");
  }
  return tournament;
}

async function requirePhase(ctx: TournamentCtx, phaseId: Id<"tournamentPhases">) {
  const phase = await ctx.db.get(phaseId);
  if (!phase) {
    throw new Error("Tournament phase not found");
  }
  return phase;
}

async function requireSwissPhase(
  ctx: TournamentCtx,
  tournamentId: Id<"tournaments">,
) {
  const phase = await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId_and_phaseOrder", (q) =>
      q.eq("tournamentId", tournamentId).eq("phaseOrder", 1),
    )
    .unique();
  if (!phase || phase.phaseType !== SWISS_FORMAT) {
    throw new Error("Swiss phase is not configured");
  }
  return phase;
}

async function requireRound(ctx: TournamentCtx, roundId: Id<"tournamentRounds">) {
  const round = await ctx.db.get(roundId);
  if (!round) {
    throw new Error("Round not found");
  }
  return round;
}

async function requireMatch(ctx: TournamentCtx, matchId: Id<"tournamentMatches">) {
  const match = await ctx.db.get(matchId);
  if (!match) {
    throw new Error("Match not found");
  }
  return match;
}

async function requireRegistration(
  ctx: TournamentCtx,
  registrationId: Id<"tournamentRegistrations">,
) {
  const registration = await ctx.db.get(registrationId);
  if (!registration) {
    throw new Error("Registration not found");
  }
  return registration;
}

async function registrationForUser(
  ctx: TournamentCtx,
  tournamentId: Id<"tournaments">,
  userId: Id<"users">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_userId", (q) =>
      q.eq("tournamentId", tournamentId).eq("userId", userId),
    )
    .unique();
}

async function activeRegistrations(
  ctx: TournamentCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_status", (q) =>
      q.eq("tournamentId", tournamentId).eq("status", "active"),
    )
    .take(512);
}

async function requireCapacityAvailable(
  ctx: TournamentCtx,
  tournament: Doc<"tournaments">,
) {
  const active = await activeRegistrations(ctx, tournament._id);
  if (active.length >= tournament.playerCapacity) {
    throw new Error("Tournament is at capacity");
  }
}

async function roundMatches(ctx: TournamentCtx, roundId: Id<"tournamentRounds">) {
  return await ctx.db
    .query("tournamentMatches")
    .withIndex("by_tournamentRoundId_and_tableNumber", (q) =>
      q.eq("tournamentRoundId", roundId),
    )
    .take(512);
}

async function matchPlayers(
  ctx: TournamentCtx,
  matchId: Id<"tournamentMatches">,
) {
  return await ctx.db
    .query("tournamentMatchPlayers")
    .withIndex("by_tournamentMatchId_and_playerId", (q) =>
      q.eq("tournamentMatchId", matchId),
    )
    .take(2);
}

async function createRoundWithPairings(
  ctx: MutationCtx,
  args: {
    tournament: Doc<"tournaments">;
    phase: Doc<"tournamentPhases">;
    roundNumber: number;
    registrations: Doc<"tournamentRegistrations">[];
    previousRoundId?: Id<"tournamentRounds">;
  },
) {
  const now = Date.now();
  const roundId = await ctx.db.insert("tournamentRounds", {
    tournamentId: args.tournament._id,
    tournamentPhaseId: args.phase._id,
    roundNumber: args.roundNumber,
    roundName: `Round ${args.roundNumber}`,
    roundStatus: "in_progress",
    createdAt: now,
    updatedAt: now,
  });
  const ranked = await rankedRegistrationsForPairing(ctx, {
    registrations: args.registrations,
    previousRoundId: args.previousRoundId,
  });
  const pairings = await buildSwissPairings(ctx, ranked);

  let tableNumber = 1;
  for (const pairing of pairings) {
    const matchId = await ctx.db.insert("tournamentMatches", {
      tournamentId: args.tournament._id,
      tournamentPhaseId: args.phase._id,
      tournamentRoundId: roundId,
      tableNumber,
      matchStatus: pairing.isBye ? "completed" : "upcoming",
      createdAt: now,
      updatedAt: now,
    });

    if (pairing.isBye) {
      await ctx.db.insert("tournamentMatchPlayers", {
        tournamentMatchId: matchId,
        playerId: pairing.playerOne._id,
        matchPointsEarned: BYE_MATCH_POINTS,
        gameWins: 2,
        gameLosses: 0,
        isBye: true,
        createdAt: now,
        updatedAt: now,
      });
    } else if (pairing.playerTwo) {
      await ctx.db.insert("tournamentMatchPlayers", {
        tournamentMatchId: matchId,
        playerId: pairing.playerOne._id,
        opponentPlayerId: pairing.playerTwo._id,
        isBye: false,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("tournamentMatchPlayers", {
        tournamentMatchId: matchId,
        playerId: pairing.playerTwo._id,
        opponentPlayerId: pairing.playerOne._id,
        isBye: false,
        createdAt: now,
        updatedAt: now,
      });
    }

    tableNumber += 1;
  }

  return roundId;
}

async function rankedRegistrationsForPairing(
  ctx: TournamentCtx,
  args: {
    registrations: Doc<"tournamentRegistrations">[];
    previousRoundId?: Id<"tournamentRounds">;
  },
): Promise<RankedRegistration[]> {
  if (!args.previousRoundId) {
    return [...args.registrations]
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((registration) => ({
        registration,
        matchPoints: 0,
        opponentMatchWinPct: 0,
        gameWinPct: 0,
        opponentGameWinPct: 0,
        createdAt: registration.createdAt,
      }));
  }

  const previousRoundId = args.previousRoundId;
  const standings = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", previousRoundId),
    )
    .take(512);
  const standingByPlayer = new Map(
    standings.map((standing) => [standing.playerId, standing]),
  );

  return [...args.registrations]
    .map((registration) => {
      const standing = standingByPlayer.get(registration._id);
      return {
        registration,
        matchPoints: standing?.matchPoints ?? 0,
        opponentMatchWinPct: standing?.opponentMatchWinPct ?? 0,
        gameWinPct: standing?.gameWinPct ?? 0,
        opponentGameWinPct: standing?.opponentGameWinPct ?? 0,
        createdAt: registration.createdAt,
      };
    })
    .sort(compareRankedRegistrations);
}

async function buildSwissPairings(
  ctx: TournamentCtx,
  rankedRegistrations: RankedRegistration[],
): Promise<Pairing[]> {
  const remaining = [...rankedRegistrations].sort(compareRankedRegistrations);
  const pairings: Pairing[] = [];

  if (remaining.length % 2 === 1) {
    let byeIndex = remaining.length - 1;
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (!(await playerHasBye(ctx, remaining[index].registration._id))) {
        byeIndex = index;
        break;
      }
    }
    const bye = remaining.splice(byeIndex, 1)[0];
    pairings.push({ playerOne: bye.registration, isBye: true });
  }

  while (remaining.length > 0) {
    const playerOne = remaining.shift();
    if (!playerOne) {
      break;
    }
    let opponentIndex = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      if (
        !(await playersHavePlayed(
          ctx,
          playerOne.registration._id,
          candidate.registration._id,
        ))
      ) {
        opponentIndex = index;
        break;
      }
    }
    const playerTwo = remaining.splice(opponentIndex, 1)[0];
    if (!playerTwo) {
      pairings.push({ playerOne: playerOne.registration, isBye: true });
    } else {
      pairings.push({
        playerOne: playerOne.registration,
        playerTwo: playerTwo.registration,
        isBye: false,
      });
    }
  }

  return pairings;
}

async function playerHasBye(
  ctx: TournamentCtx,
  playerId: Id<"tournamentRegistrations">,
) {
  const rows = await ctx.db
    .query("tournamentMatchPlayers")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerId))
    .take(64);
  return rows.some((row) => row.isBye);
}

async function playersHavePlayed(
  ctx: TournamentCtx,
  playerOneId: Id<"tournamentRegistrations">,
  playerTwoId: Id<"tournamentRegistrations">,
) {
  const rows = await ctx.db
    .query("tournamentMatchPlayers")
    .withIndex("by_playerId", (q) => q.eq("playerId", playerOneId))
    .take(128);
  return rows.some((row) => row.opponentPlayerId === playerTwoId);
}

async function replaceStandingsForRound(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  phase: Doc<"tournamentPhases">,
  round: Doc<"tournamentRounds">,
) {
  const existing = await ctx.db
    .query("roundStandings")
    .withIndex("by_tournamentRoundId_and_rank", (q) =>
      q.eq("tournamentRoundId", round._id),
    )
    .take(512);
  for (const standing of existing) {
    await ctx.db.delete(standing._id);
  }

  const stats = await calculatePlayerStatsThroughRound(
    ctx,
    tournament._id,
    round.roundNumber,
  );
  const ranked = [...stats.values()].sort((left, right) =>
    compareStandingRows(
      comparableFromStats(left, stats),
      comparableFromStats(right, stats),
    ),
  );
  const now = Date.now();

  for (let index = 0; index < ranked.length; index += 1) {
    const playerStats = ranked[index];
    const comparable = comparableFromStats(playerStats, stats);
    await ctx.db.insert("roundStandings", {
      tournamentId: tournament._id,
      tournamentPhaseId: phase._id,
      tournamentRoundId: round._id,
      playerId: playerStats.registration._id,
      rank: index + 1,
      matchPoints: playerStats.matchPoints,
      matchWins: playerStats.matchWins,
      matchLosses: playerStats.matchLosses,
      matchDraws: playerStats.matchDraws,
      opponentMatchWinPct: comparable.opponentMatchWinPct,
      gameWinPct: comparable.gameWinPct,
      opponentGameWinPct: comparable.opponentGameWinPct,
      sortKey: index + 1,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function calculatePlayerStatsThroughRound(
  ctx: TournamentCtx,
  tournamentId: Id<"tournaments">,
  roundNumber: number,
) {
  const registrations = await activeRegistrations(ctx, tournamentId);
  const stats = new Map<Id<"tournamentRegistrations">, PlayerStats>();
  for (const registration of registrations) {
    stats.set(registration._id, {
      registration,
      matchPoints: 0,
      matchWins: 0,
      matchLosses: 0,
      matchDraws: 0,
      gameWins: 0,
      gameLosses: 0,
      opponentIds: [],
      createdAt: registration.createdAt,
    });
  }

  for (const registration of registrations) {
    const playerRows = await ctx.db
      .query("tournamentMatchPlayers")
      .withIndex("by_playerId", (q) => q.eq("playerId", registration._id))
      .take(64);
    const playerStats = stats.get(registration._id);
    if (!playerStats) {
      continue;
    }

    for (const playerRow of playerRows) {
      const match = await ctx.db.get(playerRow.tournamentMatchId);
      if (!match || match.tournamentId !== tournamentId) {
        continue;
      }
      const round = await ctx.db.get(match.tournamentRoundId);
      if (
        !round ||
        round.roundNumber > roundNumber ||
        (match.matchStatus !== "completed" && match.matchStatus !== "confirmed")
      ) {
        continue;
      }

      const points = playerRow.matchPointsEarned ?? 0;
      playerStats.matchPoints += points;
      playerStats.gameWins += playerRow.gameWins ?? 0;
      playerStats.gameLosses += playerRow.gameLosses ?? 0;
      if (playerRow.opponentPlayerId) {
        playerStats.opponentIds.push(playerRow.opponentPlayerId);
      }
      if (points === MATCH_WIN_VALUE || playerRow.isBye) {
        playerStats.matchWins += 1;
      } else if (points === MATCH_DRAW_VALUE) {
        playerStats.matchDraws += 1;
      } else {
        playerStats.matchLosses += 1;
      }
    }
  }

  return stats;
}

const MATCH_WIN_VALUE = 3;
const MATCH_DRAW_VALUE = 1;

function comparableFromStats(
  playerStats: PlayerStats,
  allStats: Map<Id<"tournamentRegistrations">, PlayerStats>,
) {
  const opponentMatchWinPct = average(
    playerStats.opponentIds.map((opponentId) =>
      Math.max(0.33, matchWinPct(allStats.get(opponentId))),
    ),
  );
  const opponentGameWinPct = average(
    playerStats.opponentIds.map((opponentId) =>
      Math.max(0.33, gameWinPct(allStats.get(opponentId))),
    ),
  );

  return {
    matchPoints: playerStats.matchPoints,
    opponentMatchWinPct,
    gameWinPct: gameWinPct(playerStats),
    opponentGameWinPct,
    createdAt: playerStats.createdAt,
  };
}

function matchWinPct(stats: PlayerStats | undefined) {
  if (!stats) {
    return 0;
  }
  const matches = stats.matchWins + stats.matchLosses + stats.matchDraws;
  if (matches === 0) {
    return 0;
  }
  return (stats.matchWins + stats.matchDraws / 3) / matches;
}

function gameWinPct(stats: PlayerStats | undefined) {
  if (!stats) {
    return 0;
  }
  const games = stats.gameWins + stats.gameLosses;
  if (games === 0) {
    return 0;
  }
  return stats.gameWins / games;
}

function average(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compareRankedRegistrations(
  left: RankedRegistration,
  right: RankedRegistration,
) {
  return compareStandingRows(left, right);
}

async function completeTournamentInternal(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
) {
  const { tournament } = await requireOrganizerAccess(ctx, tournamentId);
  const phase = await requireSwissPhase(ctx, tournament._id);
  if (!phase.phaseCurrentRound) {
    throw new Error("Current round not found");
  }
  const currentRound = await requireRound(ctx, phase.phaseCurrentRound);
  if (currentRound.roundStatus !== "completed") {
    throw new Error("Current round must be completed first");
  }

  const now = Date.now();
  await ctx.db.patch(phase._id, { phaseStatus: "completed", updatedAt: now });
  await ctx.db.patch(tournament._id, { status: "completed", updatedAt: now });
}

async function seedTestPlayersInternal(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  count: number,
) {
  const tournament = await requireTournament(ctx, tournamentId);
  requireTestTournament(tournament);
  const targetCount = Math.min(validCapacity(count), tournament.playerCapacity);
  const now = Date.now();

  for (let playerNumber = 1; playerNumber <= targetCount; playerNumber += 1) {
    const existingTestPlayer = await ctx.db
      .query("testTournamentPlayers")
      .withIndex("by_tournamentId_and_playerNumber", (q) =>
        q.eq("tournamentId", tournamentId).eq("playerNumber", playerNumber),
      )
      .unique();
    if (existingTestPlayer) {
      continue;
    }

    const tokenIdentifier = `test:${tournamentId}:player:${playerNumber}`;
    const existingUser = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", tokenIdentifier),
      )
      .unique();
    const userId =
      existingUser?._id ??
      (await ctx.db.insert("users", {
        tokenIdentifier,
        workosUserId: tokenIdentifier,
        email: `player${playerNumber}@test.tournament.local`,
        name: `Test Player ${playerNumber}`,
        createdAt: now,
        updatedAt: now,
      }));

    await ctx.db.insert("testTournamentPlayers", {
      tournamentId,
      userId,
      playerNumber,
      createdAt: now,
      updatedAt: now,
    });

    const existingRegistration = await registrationForUser(ctx, tournamentId, userId);
    if (!existingRegistration) {
      await ctx.db.insert("tournamentRegistrations", {
        tournamentId,
        userId,
        status: "active",
        createdAt: now + playerNumber,
        updatedAt: now,
      });
    }
  }
}

async function generateTestResultsInternal(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  round: Doc<"tournamentRounds">,
) {
  requireTestTournament(tournament);
  const config = await requireTestConfig(ctx, tournament._id);
  const matches = await roundMatches(ctx, round._id);

  for (const match of matches) {
    if (match.matchStatus === "completed" || match.matchStatus === "confirmed") {
      continue;
    }
    const players = await matchPlayers(ctx, match._id);
    if (players.length !== 2) {
      continue;
    }

    const random = createSeededRandom(
      config.seed + round.roundNumber * 1000 + match.tableNumber,
    );
    const result = simulatedMatchResult(random);
    const [playerOnePoints, playerTwoPoints] = matchPointsForResult(result);
    const now = Date.now();
    await ctx.db.patch(players[0]._id, {
      matchPointsEarned: playerOnePoints,
      gameWins: result.playerOneGameWins,
      gameLosses: result.playerTwoGameWins,
      updatedAt: now,
    });
    await ctx.db.patch(players[1]._id, {
      matchPointsEarned: playerTwoPoints,
      gameWins: result.playerTwoGameWins,
      gameLosses: result.playerOneGameWins,
      updatedAt: now,
    });
    await ctx.db.patch(match._id, { matchStatus: "completed", updatedAt: now });
  }
}

async function requireTestConfig(
  ctx: TournamentCtx,
  tournamentId: Id<"tournaments">,
) {
  const config = await ctx.db
    .query("tournamentTestConfigs")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .unique();
  if (!config) {
    throw new Error("Test tournament config not found");
  }
  return config;
}

async function deleteTestTournamentOperationalData(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
) {
  const testPlayers = await ctx.db
    .query("testTournamentPlayers")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  const registrations = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  const phases = await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(16);
  const configs = await ctx.db
    .query("tournamentTestConfigs")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(16);

  for (const phase of phases) {
    const rounds = await ctx.db
      .query("tournamentRounds")
      .withIndex("by_tournamentPhaseId", (q) =>
        q.eq("tournamentPhaseId", phase._id),
      )
      .take(128);
    for (const round of rounds) {
      const matches = await roundMatches(ctx, round._id);
      const standings = await ctx.db
        .query("roundStandings")
        .withIndex("by_tournamentRoundId_and_rank", (q) =>
          q.eq("tournamentRoundId", round._id),
        )
        .take(512);
      for (const match of matches) {
        const players = await matchPlayers(ctx, match._id);
        for (const player of players) {
          await ctx.db.delete(player._id);
        }
        await ctx.db.delete(match._id);
      }
      for (const standing of standings) {
        await ctx.db.delete(standing._id);
      }
      await ctx.db.delete(round._id);
    }
    await ctx.db.delete(phase._id);
  }

  for (const registration of registrations) {
    await ctx.db.delete(registration._id);
  }
  for (const testPlayer of testPlayers) {
    await ctx.db.delete(testPlayer._id);
    await ctx.db.delete(testPlayer.userId);
  }
  for (const config of configs) {
    await ctx.db.delete(config._id);
  }
}

function requireSetupEditable(tournament: Doc<"tournaments">) {
  if (tournament.status === "in_progress" || tournament.status === "completed") {
    throw new Error("Tournament setup is locked");
  }
  if (tournament.status === "cancelled") {
    throw new Error("Tournament has been cancelled");
  }
}

function requireTestTournament(tournament: Doc<"tournaments">) {
  if (tournament.isTestEvent !== true) {
    throw new Error("Tournament is not a test event");
  }
}

function cleanName(value: string, label: string) {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    throw new Error(`${label} must be at least 2 characters`);
  }
  return trimmed;
}

function validCapacity(value: number) {
  const capacity = Math.trunc(value);
  if (capacity < 2 || capacity > 512) {
    throw new Error("Player capacity must be between 2 and 512");
  }
  return capacity;
}

function validRoundCount(value: number) {
  const rounds = Math.trunc(value);
  if (rounds < 1 || rounds > 16) {
    throw new Error("Swiss rounds must be between 1 and 16");
  }
  return rounds;
}

function validPhaseInputs(phases: TournamentPhaseInput[]) {
  if (phases.length < 1) {
    throw new Error("At least one Swiss phase is required");
  }
  if (phases.length > 16) {
    throw new Error("A tournament can have at most 16 phases");
  }

  return phases.map((phase, index) => {
    const expectedOrder = index + 1;
    if (Math.trunc(phase.phaseOrder) !== expectedOrder) {
      throw new Error("Swiss phases must be ordered starting at 1");
    }
    if (phase.phaseRoundMode === "dynamic") {
      return {
        phaseOrder: expectedOrder,
        phaseRoundMode: "dynamic" as const,
        phaseTotalRounds: null,
      };
    }

    return {
      phaseOrder: expectedOrder,
      phaseRoundMode: "fixed" as const,
      phaseTotalRounds: validRoundCount(phase.phaseTotalRounds ?? 0),
    };
  });
}

async function createSwissPhases(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  phases: ReturnType<typeof validPhaseInputs>,
  now: number,
) {
  for (const phase of phases) {
    await ctx.db.insert("tournamentPhases", {
      tournamentId,
      phaseType: SWISS_FORMAT,
      phaseOrder: phase.phaseOrder,
      phaseStatus: "upcoming",
      phaseRoundMode: phase.phaseRoundMode,
      phaseTotalRounds: phase.phaseTotalRounds,
      phaseCutoff: null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

async function resolvePhaseTotalRounds(
  ctx: MutationCtx,
  phase: Doc<"tournamentPhases">,
  activePlayerCount: number,
) {
  if (phase.phaseRoundMode === "fixed") {
    if (phase.phaseTotalRounds === null) {
      throw new Error("Fixed Swiss phase is missing a round count");
    }
    return phase.phaseTotalRounds;
  }

  const phaseTotalRounds = validRoundCount(
    defaultSwissRoundCount(activePlayerCount),
  );
  if (phase.phaseTotalRounds !== phaseTotalRounds) {
    await ctx.db.patch(phase._id, {
      phaseTotalRounds,
      updatedAt: Date.now(),
    });
  }
  return phaseTotalRounds;
}

function requireResolvedPhaseTotalRounds(phase: Doc<"tournamentPhases">) {
  if (phase.phaseTotalRounds === null) {
    throw new Error("Swiss phase round count is not resolved");
  }
  return phase.phaseTotalRounds;
}
