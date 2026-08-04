import type { TournamentFormat } from "@tournament-os/shared/tournament-creation-utils";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireActiveMembership, requireCurrentUser } from "./access";
import { logAuditEvent } from "./auditLog";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./batching";
import { cutoffQualifiersForNextPhase } from "./cutoffs";
import {
  SINGLE_ELIMINATION_FORMAT,
  SINGLE_ELIMINATION_PLAYERS,
  createPhases,
  phasesInOrder,
  requireCurrentPhase,
  type validPhaseInputs,
} from "./phases";
import { nextPublicCode } from "./publicCodes";
import {
  MAX_TOURNAMENT_PLAYERS,
  activeRegistrations,
  registrationForUser,
} from "./registrations";

export const TOURNAMENT_PUBLIC_CODE_COUNTER_KEY = "tournamentPublicCode";
export const FIRST_TOURNAMENT_PUBLIC_CODE = 100_001;

export type TournamentAccess = {
  tournament: Doc<"tournaments">;
  user: Doc<"users">;
  membership: Doc<"organizationMemberships">;
};

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

// Confirmed participants retain read access after drops and eliminations;
// cancelled, rejected, pending, and waitlisted entries do not.
export async function requireRegisteredPlayer(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
) {
  const tournament = await requireTournament(ctx, tournamentId);
  const user = await requireCurrentUser(ctx);
  const registration = await registrationForUser(ctx, tournamentId, user._id);
  if (!registration || registration.entryStatus !== "confirmed") {
    throw new Error("Not registered for this tournament");
  }
  return { tournament, user, registration };
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

export async function createTournament(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organizations">;
    name: string;
    startDate: number;
    playerCapacity: number;
    format: TournamentFormat;
    isTestEvent: boolean;
    decklistRequired: boolean;
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
    startDate: validStartDate(args.startDate),
    playerCapacity: validCapacity(args.playerCapacity),
    format: args.format,
    isTestEvent: args.isTestEvent,
    autoPublishPairings: false,
    decklistRequired: args.decklistRequired,
    confirmedRegistrationCount: 0,
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
  const laterUpcomingPhases = (await phasesInOrder(ctx, tournament._id)).filter(
    (p) => p.phaseOrder > phase.phaseOrder && p.phaseStatus === "upcoming",
  );
  const nextPhase = laterUpcomingPhases.at(0);
  if (nextPhase) {
    // An unplayable next phase may be skipped: a top-8 playoff without eight
    // active players, or a Swiss phase whose entry cutoff fewer than two
    // players cleared. Phases after it are unplayable too — nobody advances
    // through a skipped phase — so cancel them all.
    const canSkipUnplayableNextPhase =
      nextPhase.phaseType === SINGLE_ELIMINATION_FORMAT
        ? (await activeRegistrations(ctx, tournament._id)).length <
          SINGLE_ELIMINATION_PLAYERS
        : phase.phaseCutoff !== null &&
          (
            await cutoffQualifiersForNextPhase(
              ctx,
              currentRound._id,
              phase.phaseCutoff,
              nextPhase,
            )
          ).length < 2;
    if (!canSkipUnplayableNextPhase) {
      throw new Error(
        "The next phase has not been played; generate its first round instead",
      );
    }
    for (const upcomingPhase of laterUpcomingPhases) {
      await ctx.db.patch(upcomingPhase._id, {
        phaseStatus: "cancelled",
        updatedAt: Date.now(),
      });
    }
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

// Convex's v.number() validator accepts every IEEE-754 double, including NaN
// and the infinities (see model/pagination.ts for the same hole on page
// sizes). startDate is denormalized onto every registration and drives an
// index-ordered pagination cursor (by_userId_and_entryStatus_and_
// tournamentStartDate), so a non-finite value must never reach the tournament
// document or the fan-out that copies it there.
export function validStartDate(value: number) {
  if (!Number.isFinite(value)) {
    throw new Error("Tournament start date must be a valid date");
  }
  return value;
}

export function validCapacity(value: number) {
  const capacity = Math.trunc(value);
  // Number.isInteger(NaN) and Number.isInteger(±Infinity) are both false, so
  // this also rejects non-finite input that a bare range check would not:
  // Math.trunc(NaN) is NaN, and every comparison against NaN is false, so
  // `NaN < 2 || NaN > MAX_TOURNAMENT_PLAYERS` would otherwise silently pass.
  if (
    !Number.isInteger(capacity) ||
    capacity < 2 ||
    capacity > MAX_TOURNAMENT_PLAYERS
  ) {
    throw new Error(
      `Player capacity must be between 2 and ${MAX_TOURNAMENT_PLAYERS}`,
    );
  }
  return capacity;
}
