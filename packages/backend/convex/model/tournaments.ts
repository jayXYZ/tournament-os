import type { TournamentFormat } from "@tournament-os/core/tournament-creation-utils";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireActiveMembership, requireCurrentUser } from "./access";

export const SWISS_FORMAT = "swiss";

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
export async function allRegistrations(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
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
    .take(512);
}

export async function requireCapacityAvailable(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
) {
  const active = await activeRegistrations(ctx, tournament._id);
  if (active.length >= tournament.playerCapacity) {
    throw new Error("Tournament is at capacity");
  }
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
    .take(512);
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
  const tournamentId = await ctx.db.insert("tournaments", {
    name: cleanName(args.name, "Tournament name"),
    organizationId: args.organizationId,
    createdBy: user._id,
    status: "private",
    startDate: args.startDate,
    playerCapacity: validCapacity(args.playerCapacity),
    format: args.format,
    isTestEvent: args.isTestEvent,
    updatedAt: now,
  });

  await createSwissPhases(ctx, tournamentId, args.phases, now);
  return tournamentId;
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
  await ctx.db.patch(tournament._id, { status: "completed", updatedAt: now });
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
  if (tournament.status === "cancelled") {
    return { kind: "tournamentCancelled" };
  }
  if (tournament.status === "completed") {
    return { kind: "tournamentCompleted" };
  }

  const phase = await swissPhaseOrNull(ctx, tournament._id);
  if (tournament.status !== "in_progress") {
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

export function requireSetupEditable(tournament: Doc<"tournaments">) {
  if (
    tournament.status === "in_progress" ||
    tournament.status === "completed"
  ) {
    throw new Error("Tournament setup is locked");
  }
  if (tournament.status === "cancelled") {
    throw new Error("Tournament has been cancelled");
  }
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
  if (capacity < 2 || capacity > 512) {
    throw new Error("Player capacity must be between 2 and 512");
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
