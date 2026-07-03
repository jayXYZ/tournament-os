import type { TournamentFormat } from "@tournament-os/shared/tournament-creation-utils";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireActiveMembership, requireCurrentUser } from "./access";
import { nextPublicCode } from "./publicCodes";

export const SWISS_FORMAT = "swiss";
export const TOURNAMENT_PUBLIC_CODE_COUNTER_KEY = "tournamentPublicCode";
export const FIRST_TOURNAMENT_PUBLIC_CODE = 100_001;

// Hard ceiling on players (and therefore matches) per tournament. Bounds every
// per-tournament `.take(...)` so list and standings queries stay well under
// Convex's 4,096 index-ranges-read-per-transaction limit. Raising this requires
// re-checking that the read queries denormalize joins (see playerName fields).
export const MAX_TOURNAMENT_PLAYERS = 2048;

// Resolved display name for a user, mirroring the client's name fallback. Stored
// on registrations/standings/match players so list queries skip the user join.
export function playerDisplayName(
  user: Doc<"users"> | null | undefined,
): string | undefined {
  return user?.name ?? user?.email ?? undefined;
}

// Name for a player, preferring the denormalized copy and only reading through
// to the user document when a (legacy) registration lacks one. Used by readers
// as the fallback path so a missing denormalized name never blocks correctness.
export async function registrationDisplayName(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
): Promise<string | undefined> {
  const registration = await ctx.db.get(registrationId);
  if (!registration) {
    return undefined;
  }
  if (registration.playerName !== undefined) {
    return registration.playerName;
  }
  return playerDisplayName(await ctx.db.get(registration.userId));
}

export type TournamentAccess = {
  tournament: Doc<"tournaments">;
  user: Doc<"users">;
  membership: Doc<"organizationMemberships">;
};

export type TournamentPhaseInput = {
  phaseOrder: number;
  phaseRoundMode: "dynamic" | "fixed";
  phaseTotalRounds?: number;
};

export function defaultSwissRoundCount(playerCount: number) {
  if (playerCount <= 1) {
    return 1;
  }

  return Math.ceil(Math.log2(playerCount));
}

export async function requireOrganizerAccess(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
): Promise<TournamentAccess> {
  const tournament = await requireTournament(ctx, tournamentId);
  const { user, membership } = await requireActiveMembership(
    ctx,
    tournament.organizationId,
  );
  return { tournament, user, membership };
}

export async function requireTournament(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const tournament = await ctx.db.get(tournamentId);
  if (!tournament) {
    throw new Error("Tournament not found");
  }
  return tournament;
}

export async function requirePhase(
  ctx: QueryCtx,
  phaseId: Id<"tournamentPhases">,
) {
  const phase = await ctx.db.get(phaseId);
  if (!phase) {
    throw new Error("Tournament phase not found");
  }
  return phase;
}

export async function requireRound(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
) {
  const round = await ctx.db.get(roundId);
  if (!round) {
    throw new Error("Round not found");
  }
  return round;
}

export async function requireMatch(
  ctx: QueryCtx,
  matchId: Id<"tournamentMatches">,
) {
  const match = await ctx.db.get(matchId);
  if (!match) {
    throw new Error("Match not found");
  }
  return match;
}

export async function requireRegistration(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
) {
  const registration = await ctx.db.get(registrationId);
  if (!registration) {
    throw new Error("Registration not found");
  }
  return registration;
}

export async function swissPhaseOrNull(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const phase = await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId_and_phaseOrder", (q) =>
      q.eq("tournamentId", tournamentId).eq("phaseOrder", 1),
    )
    .unique();
  if (!phase || phase.phaseType !== SWISS_FORMAT) {
    return null;
  }
  return phase;
}

export async function requireSwissPhase(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const phase = await swissPhaseOrNull(ctx, tournamentId);
  if (!phase) {
    throw new Error("Swiss phase is not configured");
  }
  return phase;
}

export async function registrationForUser(
  ctx: QueryCtx,
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

// Any registration status grants read access: dropped players keep watching
// standings and pairings. Mutations check registration status themselves.
export async function requireRegisteredPlayer(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const tournament = await requireTournament(ctx, tournamentId);
  const user = await requireCurrentUser(ctx);
  const registration = await registrationForUser(ctx, tournamentId, user._id);
  if (!registration) {
    throw new Error("Not registered for this tournament");
  }
  return { tournament, user, registration };
}

// Includes dropped/eliminated/disqualified players: their match history must
// still feed opponents' tiebreakers even though they are no longer ranked.
// Collects every row rather than capping at MAX_TOURNAMENT_PLAYERS: capacity
// only bounds *active* registrations, but dropped rows persist (one row per
// user, reused on re-register), so churn can push the total past capacity. A
// cap here would silently drop the newest rows — potentially active entrants —
// from standings. The query is scoped to a single tournament via an equality
// index, and Convex's read limit is the backstop against pathological churn.
export async function allRegistrations(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .collect();
}

export async function activeRegistrations(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId_and_status", (q) =>
      q.eq("tournamentId", tournamentId).eq("status", "active"),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
}

export function requireCapacityAvailable(tournament: Doc<"tournaments">) {
  if (tournament.activeRegistrationCount >= tournament.playerCapacity) {
    throw new Error("Tournament is at capacity");
  }
}

// Maintains the denormalized active-registration count on the tournament so
// list queries never fan out into per-tournament registration scans. Callers
// pass the signed delta for the status transition they just applied.
export async function adjustActiveRegistrationCount(
  ctx: MutationCtx,
  tournament: Doc<"tournaments">,
  delta: number,
  now = Date.now(),
) {
  if (delta === 0) {
    return;
  }
  await ctx.db.patch(tournament._id, {
    activeRegistrationCount: Math.max(
      0,
      tournament.activeRegistrationCount + delta,
    ),
    updatedAt: now,
  });
}

export async function roundMatches(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
) {
  return await ctx.db
    .query("tournamentMatches")
    .withIndex("by_tournamentRoundId_and_tableNumber", (q) =>
      q.eq("tournamentRoundId", roundId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
}

export async function matchPlayers(
  ctx: QueryCtx,
  matchId: Id<"tournamentMatches">,
) {
  return await ctx.db
    .query("tournamentMatchPlayers")
    .withIndex("by_tournamentMatchId_and_playerId", (q) =>
      q.eq("tournamentMatchId", matchId),
    )
    .take(2);
}

export async function createTournament(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    name: string;
    startDate: number;
    playerCapacity: number;
    format: TournamentFormat;
    isTestEvent: boolean;
    phases: ReturnType<typeof validPhaseInputs>;
  },
) {
  const { user } = await requireActiveMembership(ctx, args.organizationId);
  const now = Date.now();
  const publicCode = await nextTournamentPublicCode(ctx, now);
  const tournamentId = await ctx.db.insert("tournaments", {
    name: cleanName(args.name, "Tournament name"),
    publicCode,
    organizationId: args.organizationId,
    createdBy: user._id,
    visibility: "public",
    lifecycle: "setup",
    startDate: args.startDate,
    playerCapacity: validCapacity(args.playerCapacity),
    format: args.format,
    isTestEvent: args.isTestEvent,
    activeRegistrationCount: 0,
    seed: Math.floor(Math.random() * 0x7fffffff),
    updatedAt: now,
  });

  await createSwissPhases(ctx, tournamentId, args.phases, now);
  return tournamentId;
}

export async function nextTournamentPublicCode(
  ctx: MutationCtx,
  now = Date.now(),
) {
  return await nextPublicCode(
    ctx,
    TOURNAMENT_PUBLIC_CODE_COUNTER_KEY,
    FIRST_TOURNAMENT_PUBLIC_CODE,
    now,
  );
}

export async function createSwissPhases(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  phases: ReturnType<typeof validPhaseInputs>,
  now: number,
) {
  for (const phase of phases) {
    await ctx.db.insert("tournamentPhases", {
      tournamentId,
      phaseName: `Phase ${phase.phaseOrder}`,
      phaseType: SWISS_FORMAT,
      phaseOrder: phase.phaseOrder,
      phaseStatus: "upcoming",
      phaseRoundMode: phase.phaseRoundMode,
      phaseTotalRounds: phase.phaseTotalRounds,
      phaseCutoff: null,
      powerPairFinalRound: true,
      updatedAt: now,
    });
  }
}

export async function completeTournament(
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
  await ctx.db.patch(tournament._id, {
    lifecycle: "completed",
    updatedAt: now,
  });
}

export type PairingsNextStep =
  | { kind: "startTournament"; ready: boolean; reason: string | null }
  | {
      kind: "generateStandings";
      ready: boolean;
      reason: string | null;
      roundId: Id<"tournamentRounds">;
    }
  | { kind: "generateNextRound"; ready: boolean; reason: string | null }
  | { kind: "completeTournament"; ready: boolean; reason: string | null }
  | { kind: "tournamentCompleted" }
  | { kind: "tournamentCancelled" };

export async function pairingsNextStep(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
): Promise<PairingsNextStep> {
  if (tournament.lifecycle === "cancelled") {
    return { kind: "tournamentCancelled" };
  }
  if (tournament.lifecycle === "completed") {
    return { kind: "tournamentCompleted" };
  }

  const phase = await swissPhaseOrNull(ctx, tournament._id);
  if (tournament.lifecycle !== "in_progress") {
    if (!phase) {
      return {
        kind: "startTournament",
        ready: false,
        reason: "Swiss phase is not configured",
      };
    }
    const registrations = await activeRegistrations(ctx, tournament._id);
    if (registrations.length < 2) {
      return {
        kind: "startTournament",
        ready: false,
        reason: "At least two active players are required",
      };
    }
    return { kind: "startTournament", ready: true, reason: null };
  }

  if (!phase || !phase.phaseCurrentRound) {
    return {
      kind: "startTournament",
      ready: false,
      reason: "Current round not found",
    };
  }

  const round = await requireRound(ctx, phase.phaseCurrentRound);
  if (round.roundStatus !== "completed") {
    const matches = await roundMatches(ctx, round._id);
    const unreported = matches.reduce(
      (count, match) =>
        match.matchStatus === "completed" || match.matchStatus === "confirmed"
          ? count
          : count + 1,
      0,
    );
    return {
      kind: "generateStandings",
      ready: unreported === 0,
      reason:
        unreported === 0
          ? null
          : `${unreported} ${unreported === 1 ? "match still needs" : "matches still need"} a result`,
      roundId: round._id,
    };
  }

  const phaseTotalRounds = phase.phaseTotalRounds;
  if (phaseTotalRounds !== null && round.roundNumber >= phaseTotalRounds) {
    return { kind: "completeTournament", ready: true, reason: null };
  }
  return { kind: "generateNextRound", ready: true, reason: null };
}

export async function resolvePhaseTotalRounds(
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

export function requireResolvedPhaseTotalRounds(
  phase: Doc<"tournamentPhases">,
) {
  if (phase.phaseTotalRounds === null) {
    throw new Error("Swiss phase round count is not resolved");
  }
  return phase.phaseTotalRounds;
}

// Deletion budget per transaction. Each invocation deletes at most this many
// documents so a max-capacity tournament stays within Convex transaction
// limits; callers reschedule until cleared.
const DELETE_BATCH_SIZE = 512;

// Deletes up to DELETE_BATCH_SIZE operational documents for a tournament:
// phases with their rounds, matches, match players, and standings, then
// registrations, test players (and their synthetic users), and test configs.
// Returns true once everything is cleared; false means more data remains and
// the caller should run another batch (e.g. by rescheduling itself via
// ctx.scheduler.runAfter).
export async function deleteTournamentOperationalDataBatch(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
): Promise<boolean> {
  let budget = DELETE_BATCH_SIZE;
  // When a page comes back full there may be rows beyond the cursor, so the
  // pass cannot prove the tournament is cleared even if budget remains.
  let sawFullPage = false;

  const phases = await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(16);
  sawFullPage ||= phases.length === 16;

  for (const phase of phases) {
    const rounds = await ctx.db
      .query("tournamentRounds")
      .withIndex("by_tournamentPhaseId", (q) =>
        q.eq("tournamentPhaseId", phase._id),
      )
      .take(128);
    sawFullPage ||= rounds.length === 128;
    for (const round of rounds) {
      const matches = await roundMatches(ctx, round._id);
      sawFullPage ||= matches.length === 512;
      for (const match of matches) {
        const players = await matchPlayers(ctx, match._id);
        if (budget < players.length + 1) {
          return false;
        }
        for (const player of players) {
          await ctx.db.delete(player._id);
          budget -= 1;
        }
        await ctx.db.delete(match._id);
        budget -= 1;
      }
      const standings = await ctx.db
        .query("roundStandings")
        .withIndex("by_tournamentRoundId_and_rank", (q) =>
          q.eq("tournamentRoundId", round._id),
        )
        .take(512);
      sawFullPage ||= standings.length === 512;
      for (const standing of standings) {
        if (budget < 1) {
          return false;
        }
        await ctx.db.delete(standing._id);
        budget -= 1;
      }
      if (budget < 1) {
        return false;
      }
      await ctx.db.delete(round._id);
      budget -= 1;
    }
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(phase._id);
    budget -= 1;
  }

  const registrations = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  sawFullPage ||= registrations.length === 512;
  for (const registration of registrations) {
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(registration._id);
    budget -= 1;
  }

  const testPlayers = await ctx.db
    .query("testTournamentPlayers")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  sawFullPage ||= testPlayers.length === 512;
  for (const testPlayer of testPlayers) {
    if (budget < 2) {
      return false;
    }
    await ctx.db.delete(testPlayer._id);
    await ctx.db.delete(testPlayer.userId);
    budget -= 2;
  }

  const configs = await ctx.db
    .query("tournamentTestConfigs")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(16);
  sawFullPage ||= configs.length === 16;
  for (const config of configs) {
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(config._id);
    budget -= 1;
  }

  return !sawFullPage;
}

export function requireSetupEditable(tournament: Doc<"tournaments">) {
  if (
    tournament.lifecycle === "in_progress" ||
    tournament.lifecycle === "completed"
  ) {
    throw new Error("Tournament setup is locked");
  }
  if (tournament.lifecycle === "cancelled") {
    throw new Error("Tournament has been cancelled");
  }
}

// A tournament is publicly viewable (by public code) once it has been
// published, unless the organizer has made it private. Unlisted events pass:
// they are link-only but still viewable by anyone who has the code.
export function isPubliclyViewable(tournament: Doc<"tournaments">) {
  return (
    tournament.visibility !== "private" && tournament.lifecycle !== "setup"
  );
}

export function requireTestTournament(tournament: Doc<"tournaments">) {
  if (tournament.isTestEvent !== true) {
    throw new Error("Tournament is not a test event");
  }
}

export function cleanName(value: string, label: string) {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    throw new Error(`${label} must be at least 2 characters`);
  }
  return trimmed;
}

export function validCapacity(value: number) {
  const capacity = Math.trunc(value);
  if (capacity < 2 || capacity > MAX_TOURNAMENT_PLAYERS) {
    throw new Error(
      `Player capacity must be between 2 and ${MAX_TOURNAMENT_PLAYERS}`,
    );
  }
  return capacity;
}

export function validRoundCount(value: number) {
  const rounds = Math.trunc(value);
  if (rounds < 1 || rounds > 16) {
    throw new Error("Swiss rounds must be between 1 and 16");
  }
  return rounds;
}

export function validPhaseInputs(phases: TournamentPhaseInput[]) {
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
