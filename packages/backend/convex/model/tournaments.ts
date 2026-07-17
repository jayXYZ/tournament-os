import type { TournamentFormat } from "@tournament-os/shared/tournament-creation-utils";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireActiveMembership, requireCurrentUser } from "./access";
import { logAuditEvent } from "./auditLog";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./batching";
import { nextPublicCode } from "./publicCodes";

export const SWISS_FORMAT = "swiss";
export const SINGLE_ELIMINATION_FORMAT = "single_elimination";
export const SINGLE_ELIMINATION_PLAYERS = 8;
export const SINGLE_ELIMINATION_ROUNDS = 3;
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
  phaseType?: "swiss" | "single_elimination";
  phaseRoundMode: "dynamic" | "fixed";
  phaseTotalRounds?: number;
  playerMeeting?: boolean;
};

// Seating order for player meetings: alphabetical by display name (case-
// insensitive, locale-aware), tie-broken by registration createdAt so players
// with identical names still seat deterministically (the same tie-break
// pairing and standings use).
export function comparePlayersAlphabetically(
  a: { playerName: string | null; createdAt: number },
  b: { playerName: string | null; createdAt: number },
) {
  const byName = (a.playerName ?? "").localeCompare(
    b.playerName ?? "",
    undefined,
    {
      sensitivity: "base",
    },
  );
  return byName !== 0 ? byName : a.createdAt - b.createdAt;
}

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

export function isPairingsVisibleToPlayers(
  round: Pick<Doc<"tournamentRounds">, "pairingsPublishedAt">,
) {
  return round.pairingsPublishedAt !== undefined;
}

// Round numbers are global across a tournament. Within a phase, the previous
// round is the preceding number; across a phase boundary it is the prior
// phase's final round.
export async function previousTournamentRound(
  ctx: QueryCtx,
  round: Doc<"tournamentRounds">,
): Promise<Doc<"tournamentRounds"> | null> {
  const phase = await requirePhase(ctx, round.tournamentPhaseId);
  const samePhaseRound = await ctx.db
    .query("tournamentRounds")
    .withIndex("by_tournamentPhaseId_and_roundNumber", (q) =>
      q
        .eq("tournamentPhaseId", round.tournamentPhaseId)
        .eq("roundNumber", round.roundNumber - 1),
    )
    .unique();
  if (samePhaseRound || phase.phaseOrder <= 1) {
    return samePhaseRound;
  }

  const previousPhase = await phaseByOrder(
    ctx,
    round.tournamentId,
    phase.phaseOrder - 1,
  );
  // A phase's phaseCurrentRound is its final round once the phase completes.
  return previousPhase?.phaseCurrentRound
    ? await ctx.db.get(previousPhase.phaseCurrentRound)
    : null;
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

// All phases in play order (bounded by the 16-phase cap).
export async function phasesInOrder(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId_and_phaseOrder", (q) =>
      q.eq("tournamentId", tournamentId),
    )
    .take(16);
}

export async function phaseByOrder(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  phaseOrder: number,
) {
  const phase = await ctx.db
    .query("tournamentPhases")
    .withIndex("by_tournamentId_and_phaseOrder", (q) =>
      q.eq("tournamentId", tournamentId).eq("phaseOrder", phaseOrder),
    )
    .unique();
  return phase;
}

export async function swissPhasesInOrder(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return (await phasesInOrder(ctx, tournamentId)).filter(
    (phase) => phase.phaseType === SWISS_FORMAT,
  );
}

export async function swissPhaseByOrder(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  phaseOrder: number,
) {
  const phase = await phaseByOrder(ctx, tournamentId, phaseOrder);
  return phase?.phaseType === SWISS_FORMAT ? phase : null;
}

// The phase play is currently anchored to: the in-progress phase if one
// exists, otherwise the most recently completed phase (its final round stays
// "current" until the next phase starts), otherwise the first upcoming phase.
// Takes phases already in phaseOrder (as phasesInOrder returns them).
export function selectCurrentPhase(phases: Doc<"tournamentPhases">[]) {
  return (
    phases.find((phase) => phase.phaseStatus === "in_progress") ??
    [...phases].reverse().find((phase) => phase.phaseStatus === "completed") ??
    phases.find((phase) => phase.phaseStatus === "upcoming") ??
    null
  );
}

export async function swissPhaseOrNull(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return selectCurrentPhase(await swissPhasesInOrder(ctx, tournamentId));
}

export async function currentPhaseOrNull(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  return selectCurrentPhase(await phasesInOrder(ctx, tournamentId));
}

export async function requireCurrentPhase(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const phase = await currentPhaseOrNull(ctx, tournamentId);
  if (!phase) {
    throw new Error("Tournament phase is not configured");
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

// A round's 1-based position within its phase. Round numbers are global
// across the tournament (Magic-style: an 8-round day 1 makes day 2 start at
// round 9), so comparisons against a phase's configured round count must use
// the offset from the phase's first round. Accepts a plain shape so it also
// works for a round that hasn't been inserted yet.
export async function roundNumberInPhase(
  ctx: QueryCtx,
  round: Pick<Doc<"tournamentRounds">, "tournamentPhaseId" | "roundNumber">,
) {
  const firstRound = await ctx.db
    .query("tournamentRounds")
    .withIndex("by_tournamentPhaseId_and_roundNumber", (q) =>
      q.eq("tournamentPhaseId", round.tournamentPhaseId),
    )
    .first();
  return round.roundNumber - (firstRound?.roundNumber ?? round.roundNumber) + 1;
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

type RegistrationStatusUpdate =
  | {
      status: "eliminated";
      eliminatedByRoundId: Id<"tournamentRounds">;
    }
  | {
      status: "active" | "dropped";
      eliminatedByRoundId?: never;
    };

export async function setRegistrationStatus(
  ctx: MutationCtx,
  registrationId: Id<"tournamentRegistrations">,
  update: RegistrationStatusUpdate & {
    playerName?: string;
    updatedAt?: number;
  },
) {
  const { updatedAt = Date.now(), ...fields } = update;
  await ctx.db.patch(registrationId, {
    ...fields,
    eliminatedByRoundId:
      update.status === "eliminated" ? update.eliminatedByRoundId : undefined,
    updatedAt,
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

export async function roundMatchesWithPlayers(
  ctx: QueryCtx,
  roundId: Id<"tournamentRounds">,
) {
  const matches = await roundMatches(ctx, roundId);
  return await mapAsyncInBatches(
    matches,
    DATABASE_IO_BATCH_SIZE,
    async (match) => ({
      match,
      players: await matchPlayers(ctx, match._id),
    }),
  );
}

export const PAIRINGS_REWIND_RECORDED_RESULT_REASON =
  "Pairings cannot be unpublished after a match result has been recorded";

export function roundHasRecordedResult(
  matchesWithPlayers: readonly {
    match: Pick<Doc<"tournamentMatches">, "matchStatus" | "tableNumber">;
    players: readonly Pick<Doc<"tournamentMatchPlayers">, "isBye">[];
  }[],
) {
  return matchesWithPlayers.some(
    ({ match, players }) =>
      !players.every((player) => player.isBye) &&
      match.matchStatus !== "upcoming",
  );
}

// A phase's player-meeting seats in table order (the index sorts by
// tableNumber). Empty when the phase never held a meeting.
export async function meetingSeats(
  ctx: QueryCtx,
  phaseId: Id<"tournamentPhases">,
) {
  return await ctx.db
    .query("playerMeetingSeats")
    .withIndex("by_tournamentPhaseId_and_tableNumber", (q) =>
      q.eq("tournamentPhaseId", phaseId),
    )
    .take(MAX_TOURNAMENT_PLAYERS);
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
    autoPublishPairings: false,
    activeRegistrationCount: 0,
    seed: Math.floor(Math.random() * 0x7fffffff),
    updatedAt: now,
  });

  await createPhases(ctx, tournamentId, args.phases, now);
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

export async function createPhases(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
  phases: ReturnType<typeof validPhaseInputs>,
  now: number,
) {
  for (const phase of phases) {
    await ctx.db.insert("tournamentPhases", {
      tournamentId,
      phaseName: `Phase ${phase.phaseOrder}`,
      phaseType: phase.phaseType,
      phaseOrder: phase.phaseOrder,
      phaseStatus: "upcoming",
      phaseRoundMode: phase.phaseRoundMode,
      phaseTotalRounds: phase.phaseTotalRounds,
      phaseCutoff: null,
      powerPairFinalRound: phase.phaseType === SWISS_FORMAT ? true : undefined,
      playerMeeting: phase.playerMeeting,
      updatedAt: now,
    });
  }
}

export async function completeTournament(
  ctx: MutationCtx,
  tournamentId: Id<"tournaments">,
) {
  const { tournament, user } = await requireOrganizerAccess(ctx, tournamentId);
  const phase = await requireCurrentPhase(ctx, tournament._id);
  if (!phase.phaseCurrentRound) {
    throw new Error("Current round not found");
  }
  const currentRound = await requireRound(ctx, phase.phaseCurrentRound);
  if (currentRound.roundStatus !== "completed") {
    throw new Error("Current round must be completed first");
  }
  // Between phases the current phase is already "completed" and its final
  // round has been played, so the checks above pass. Without this guard the
  // tournament could be marked completed while a later phase is still
  // upcoming, permanently stranding it (mirrors pairingsNextStep, which only
  // offers completion once no upcoming phase remains).
  const nextPhase = await phaseByOrder(
    ctx,
    tournament._id,
    phase.phaseOrder + 1,
  );
  if (nextPhase && nextPhase.phaseStatus === "upcoming") {
    const canSkipUnplayableTopEight =
      nextPhase.phaseType === SINGLE_ELIMINATION_FORMAT &&
      (await activeRegistrations(ctx, tournament._id)).length <
        SINGLE_ELIMINATION_PLAYERS;
    if (!canSkipUnplayableTopEight) {
      throw new Error(
        "The next phase has not been played; generate its first round instead",
      );
    }
    await ctx.db.patch(nextPhase._id, {
      phaseStatus: "cancelled",
      updatedAt: Date.now(),
    });
  }

  const now = Date.now();
  await ctx.db.patch(phase._id, { phaseStatus: "completed", updatedAt: now });
  await ctx.db.patch(tournament._id, {
    lifecycle: "completed",
    updatedAt: now,
  });
  await logAuditEvent(ctx, {
    tournamentId: tournament._id,
    actor: user,
    actorRole: "organizer",
    event: { type: "tournament_completed" },
  });
}

export type PairingsNextStep =
  | { kind: "publishTournament"; ready: boolean; reason: string | null }
  | {
      kind: "startPlayerMeeting";
      ready: boolean;
      reason: string | null;
      phaseId: Id<"tournamentPhases">;
    }
  | { kind: "startTournament"; ready: boolean; reason: string | null }
  | {
      kind: "publishPairings";
      ready: boolean;
      reason: string | null;
      roundId: Id<"tournamentRounds">;
    }
  | { kind: "startTimer"; ready: boolean; reason: string | null }
  | {
      kind: "completeRound";
      ready: boolean;
      reason: string | null;
      roundId: Id<"tournamentRounds">;
    }
  | { kind: "generateNextRound"; ready: boolean; reason: string | null }
  | { kind: "completeTournament"; ready: boolean; reason: string | null }
  | { kind: "tournamentCompleted" }
  | { kind: "tournamentCancelled" };

export type PhaseBoard = {
  phase: Doc<"tournamentPhases">;
  rounds: Doc<"tournamentRounds">[];
};

// `phaseBoards` must hold every phase in phaseOrder with each phase's full
// round list in roundNumber order (the caller already loads exactly that);
// working off it keeps this from re-reading documents the query has in hand.
export async function pairingsNextStep(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  phaseBoards: PhaseBoard[],
  currentRoundMatches?: readonly Doc<"tournamentMatches">[],
): Promise<PairingsNextStep> {
  if (tournament.lifecycle === "cancelled") {
    return { kind: "tournamentCancelled" };
  }
  if (tournament.lifecycle === "completed") {
    return { kind: "tournamentCompleted" };
  }

  const phase = selectCurrentPhase(phaseBoards.map(({ phase }) => phase));
  const board =
    phaseBoards.find(({ phase: candidate }) => candidate._id === phase?._id) ??
    null;
  if (tournament.lifecycle === "setup") {
    const hasSwissPhase = phaseBoards.some(
      ({ phase: candidate }) => candidate.phaseType === SWISS_FORMAT,
    );
    return {
      kind: "publishTournament",
      ready: hasSwissPhase,
      reason: hasSwissPhase ? null : "Swiss phase is not configured",
    };
  }

  if (tournament.lifecycle !== "in_progress") {
    if (!phase) {
      return {
        kind: "startTournament",
        ready: false,
        reason: "Tournament phase is not configured",
      };
    }
    const registrations = await activeRegistrations(ctx, tournament._id);
    const hasTopEightPlayoff = phaseBoards.some(
      ({ phase: candidate }) =>
        candidate.phaseType === SINGLE_ELIMINATION_FORMAT &&
        candidate.phaseStatus === "upcoming",
    );
    if (
      hasTopEightPlayoff &&
      registrations.length < SINGLE_ELIMINATION_PLAYERS
    ) {
      return {
        kind: "startTournament",
        ready: false,
        reason: "A top-8 playoff requires at least eight active players",
      };
    }
    // The meeting is offered exactly once: after it starts (or completes) the
    // flag no longer matters and play falls through to startTournament, which
    // closes an in-progress meeting itself.
    if (phase.playerMeeting && phase.playerMeetingStatus === undefined) {
      if (registrations.length < 2) {
        return {
          kind: "startPlayerMeeting",
          ready: false,
          reason: "At least two active players are required",
          phaseId: phase._id,
        };
      }
      return {
        kind: "startPlayerMeeting",
        ready: true,
        reason: null,
        phaseId: phase._id,
      };
    }
    if (registrations.length < 2) {
      return {
        kind: "startTournament",
        ready: false,
        reason: "At least two active players are required",
      };
    }
    return { kind: "startTournament", ready: true, reason: null };
  }

  if (!board || !phase || !phase.phaseCurrentRound) {
    return {
      kind: "startTournament",
      ready: false,
      reason: "Current round not found",
    };
  }

  const round = board.rounds.find(
    (candidate) => candidate._id === phase.phaseCurrentRound,
  );
  if (!round) {
    throw new Error("Round not found");
  }
  if (!isPairingsVisibleToPlayers(round)) {
    return {
      kind: "publishPairings",
      ready: true,
      reason: null,
      roundId: round._id,
    };
  }
  if (round.roundStatus !== "completed") {
    const matches = currentRoundMatches ?? (await roundMatches(ctx, round._id));
    const unreported = matches.reduce(
      (count, match) =>
        match.matchStatus === "completed" || match.matchStatus === "confirmed"
          ? count
          : count + 1,
      0,
    );
    // Once every match has a result, completing the round and posting standings
    // is the next step regardless of the timer (a round can finish without one
    // ever being started).
    if (unreported === 0) {
      return {
        kind: "completeRound",
        ready: true,
        reason: null,
        roundId: round._id,
      };
    }
    // The round is being played but its timer was never started (or was
    // reset): starting it is the next step, so the organizer can do it from
    // anywhere and is reminded it exists.
    if (tournament.roundTimer?.roundId !== round._id) {
      return { kind: "startTimer", ready: true, reason: null };
    }
    return {
      kind: "completeRound",
      ready: false,
      reason: `${unreported} ${unreported === 1 ? "match still needs" : "matches still need"} a result`,
      roundId: round._id,
    };
  }

  // The round's 1-based position within its phase, as in roundNumberInPhase:
  // round numbers are global across the tournament, so offset from the
  // phase's first round.
  const roundInPhase = round.roundNumber - board.rounds[0].roundNumber + 1;
  const phaseTotalRounds = phase.phaseTotalRounds;
  if (phaseTotalRounds === null || roundInPhase < phaseTotalRounds) {
    return { kind: "generateNextRound", ready: true, reason: null };
  }

  // The phase's configured rounds are done: the next round (if any) belongs to
  // the next phase, which generateNextRound starts.
  const nextPhase =
    phaseBoards.find(
      (candidate) => candidate.phase.phaseOrder === phase.phaseOrder + 1,
    )?.phase ?? null;
  if (nextPhase && nextPhase.phaseStatus === "upcoming") {
    if (nextPhase.phaseType === SINGLE_ELIMINATION_FORMAT) {
      const registrations = await activeRegistrations(ctx, tournament._id);
      if (registrations.length < SINGLE_ELIMINATION_PLAYERS) {
        return { kind: "completeTournament", ready: true, reason: null };
      }
    }
    // A later phase can hold its own meeting (e.g. a day-2 seating) before its
    // first round is paired. Same player-count gate as the pre-start branch:
    // startPlayerMeeting rejects a pool of fewer than two players.
    if (
      nextPhase.playerMeeting &&
      nextPhase.playerMeetingStatus === undefined
    ) {
      const registrations = await activeRegistrations(ctx, tournament._id);
      if (registrations.length < 2) {
        return {
          kind: "startPlayerMeeting",
          ready: false,
          reason: "At least two active players are required",
          phaseId: nextPhase._id,
        };
      }
      return {
        kind: "startPlayerMeeting",
        ready: true,
        reason: null,
        phaseId: nextPhase._id,
      };
    }
    return { kind: "generateNextRound", ready: true, reason: null };
  }
  return { kind: "completeTournament", ready: true, reason: null };
}

export async function resolvePhaseTotalRounds(
  ctx: MutationCtx,
  phase: Doc<"tournamentPhases">,
  activePlayerCount: number,
) {
  if (phase.phaseType === SINGLE_ELIMINATION_FORMAT) {
    if (phase.phaseTotalRounds !== SINGLE_ELIMINATION_ROUNDS) {
      await ctx.db.patch(phase._id, {
        phaseRoundMode: "fixed",
        phaseTotalRounds: SINGLE_ELIMINATION_ROUNDS,
        updatedAt: Date.now(),
      });
    }
    return SINGLE_ELIMINATION_ROUNDS;
  }
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
    throw new Error("Phase round count is not resolved");
  }
  return phase.phaseTotalRounds;
}

export function requireDecisiveEliminationResult(
  phase: Doc<"tournamentPhases">,
  playerOneGameWins: number,
  playerTwoGameWins: number,
) {
  if (
    phase.phaseType === SINGLE_ELIMINATION_FORMAT &&
    playerOneGameWins === playerTwoGameWins
  ) {
    throw new Error("Single-elimination matches cannot end in a draw");
  }
}

// A configured player meeting is a backend lifecycle prerequisite, not only a
// UI step. Once the meeting is in progress, pairing the phase's first round is
// what completes it.
export function requirePlayerMeetingStarted(phase: Doc<"tournamentPhases">) {
  if (phase.playerMeeting && phase.playerMeetingStatus === undefined) {
    throw new Error("Player meeting must be started first");
  }
}

// Deletion budget per transaction. Each invocation deletes at most this many
// documents so a max-capacity tournament stays within Convex transaction
// limits; callers reschedule until cleared.
const DELETE_BATCH_SIZE = 512;

// Deletes up to DELETE_BATCH_SIZE operational documents for a tournament:
// phases with their rounds, matches, match players, and standings, then
// registrations, test players (and their synthetic users), audit events, and
// test configs.
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
    const seats = await ctx.db
      .query("playerMeetingSeats")
      .withIndex("by_tournamentPhaseId_and_tableNumber", (q) =>
        q.eq("tournamentPhaseId", phase._id),
      )
      .take(512);
    sawFullPage ||= seats.length === 512;
    for (const seat of seats) {
      if (budget < 1) {
        return false;
      }
      await ctx.db.delete(seat._id);
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

  const auditEvents = await ctx.db
    .query("tournamentAuditEvents")
    .withIndex("by_tournamentId", (q) => q.eq("tournamentId", tournamentId))
    .take(512);
  sawFullPage ||= auditEvents.length === 512;
  for (const auditEvent of auditEvents) {
    if (budget < 1) {
      return false;
    }
    await ctx.db.delete(auditEvent._id);
    budget -= 1;
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
  if (tournament.lifecycle !== "setup") {
    throw new Error("Tournament setup is locked after publication");
  }
}

export function requirePreStartEditable(tournament: Doc<"tournaments">) {
  if (
    tournament.lifecycle !== "setup" &&
    tournament.lifecycle !== "registration"
  ) {
    throw new Error("Tournament setup is locked after play begins");
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

// Well below the 1MB document limit, but far more than any reasonable event
// write-up; the editor enforces the same cap client-side.
export const MAX_DETAILS_MARKDOWN_LENGTH = 20_000;

// Returns the markdown to store, or undefined when the (trimmed) text is
// empty so callers clear the field instead of storing an empty string.
export function validDetailsMarkdown(value: string) {
  if (value.length > MAX_DETAILS_MARKDOWN_LENGTH) {
    throw new Error(
      `Event details must be at most ${MAX_DETAILS_MARKDOWN_LENGTH} characters`,
    );
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
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
      throw new Error("Tournament phases must be ordered starting at 1");
    }
    const phaseType = phase.phaseType ?? SWISS_FORMAT;
    if (index === 0 && phaseType !== SWISS_FORMAT) {
      throw new Error("A single-elimination phase must follow a Swiss phase");
    }
    if (
      phaseType === SINGLE_ELIMINATION_FORMAT &&
      index !== phases.length - 1
    ) {
      throw new Error("Single elimination must be the final phase");
    }
    // Absent-default convention: store true or leave the field off entirely.
    const playerMeeting = phase.playerMeeting === true ? true : undefined;
    if (phaseType === SINGLE_ELIMINATION_FORMAT) {
      if (playerMeeting) {
        throw new Error(
          "Player meetings are not supported for single elimination",
        );
      }
      return {
        phaseOrder: expectedOrder,
        phaseType,
        phaseRoundMode: "fixed" as const,
        phaseTotalRounds: SINGLE_ELIMINATION_ROUNDS,
        playerMeeting: undefined,
      };
    }
    if (phase.phaseRoundMode === "dynamic") {
      return {
        phaseOrder: expectedOrder,
        phaseType,
        phaseRoundMode: "dynamic" as const,
        phaseTotalRounds: null,
        playerMeeting,
      };
    }

    return {
      phaseOrder: expectedOrder,
      phaseType,
      phaseRoundMode: "fixed" as const,
      phaseTotalRounds: validRoundCount(phase.phaseTotalRounds ?? 0),
      playerMeeting,
    };
  });
}
