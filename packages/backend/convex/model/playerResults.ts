import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { currentUserOrNull, getActiveMembership } from "./access";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "./batching";
import { phasesInOrder } from "./phases";
import { parsePublicCode } from "./publicCodes";
import { registrationForUser } from "./registrations";
import { isPairingsVisibleToPlayers, isPubliclyViewable } from "./tournaments";

// Rounds are capped at 16 per phase.
export const MAX_ROUNDS = 16;

// A registration plays at most one match per round, so a player's
// tournamentMatchPlayers rows are bounded by the round cap (16) times the
// phase cap (16).
export const MAX_MATCHES_PER_PLAYER = 256;

// The web UI currently asks for 10 results at a time, but pagination arguments
// are public API input and cannot be trusted to preserve that bound. Keep result
// enrichment (tournament, phases, rounds, and standings reads) comfortably
// below transaction limits even when a caller requests an enormous page.
export const MAX_PROFILE_RESULTS_PAGE_SIZE = 50;

// getPublicPlayerResults tops up hidden rows server-side: it keeps walking the
// registrations index past rows the viewer can't see until the page is full.
// This caps how many raw index rows one request may examine, because every raw
// row costs a tournament read (plus membership/registration checks for
// non-public events) and a viewer-hidden stretch can be arbitrarily long.
// Hitting the cap with nothing visible returns an empty page with
// isDone: false and a cursor advanced past every examined row, so each retry
// makes budget-sized progress instead of dead-ending. Worst case per request:
// ~3 cheap reads per raw row plus full enrichment for at most
// MAX_PROFILE_RESULTS_PAGE_SIZE visible rows — comfortably inside Convex's
// 16k-document query read limit.
export const PROFILE_RESULTS_RAW_READ_BUDGET = 300;

// getPublicPlayerResults pages with an explicit index position instead of
// ctx.db's .paginate() cursor: Convex allows only one .paginate() call per
// query, so a server-side top-up loop has to seek the index itself. The
// position is the (tournamentStartDate, _creationTime) of the last raw row
// examined — _creationTime is the index's implicit final column and unique
// within a table, so the pair totally orders one user's confirmed rows.
export type ProfileResultsCursorPosition = {
  startDate: number;
  creationTime: number;
};

const PROFILE_RESULTS_CURSOR_PREFIX = "profileResults.v1.";

export function encodeProfileResultsCursor(
  position: ProfileResultsCursorPosition,
): string {
  return (
    PROFILE_RESULTS_CURSOR_PREFIX +
    JSON.stringify([position.startDate, position.creationTime])
  );
}

// Malformed cursors (hand-edited, or a stale tab holding a cursor from before
// this format existed) throw the InvalidCursor handshake that convex/react's
// usePaginatedQuery recognizes — by ConvexError data shape and by message
// substring — and answers by resetting pagination from the first page, the
// same recovery a corrupt native paginate cursor gets.
export function decodeProfileResultsCursor(
  cursor: string,
): ProfileResultsCursorPosition {
  if (cursor.startsWith(PROFILE_RESULTS_CURSOR_PREFIX)) {
    try {
      const parsed: unknown = JSON.parse(
        cursor.slice(PROFILE_RESULTS_CURSOR_PREFIX.length),
      );
      if (
        Array.isArray(parsed) &&
        parsed.length === 2 &&
        typeof parsed[0] === "number" &&
        Number.isFinite(parsed[0]) &&
        typeof parsed[1] === "number" &&
        Number.isFinite(parsed[1])
      ) {
        return { startDate: parsed[0], creationTime: parsed[1] };
      }
    } catch {
      // Fall through to the InvalidCursor throw below.
    }
  }
  throw new ConvexError({
    isConvexSystemError: true,
    paginationError: "InvalidCursor",
    message: "InvalidCursor: malformed player results cursor",
  });
}

// Raw index rows strictly after `position` in profile-history order
// (tournamentStartDate desc, then _creationTime desc). A composite-key seek
// needs up to two ranges: the remainder of the cursor row's start date, then
// strictly older start dates. Returning fewer than `limit` rows means the
// index has no rows past the ones returned.
export async function takeConfirmedRegistrationsAfter(
  ctx: QueryCtx,
  userId: Id<"users">,
  position: ProfileResultsCursorPosition | null,
  limit: number,
) {
  if (position === null) {
    return await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_userId_and_entryStatus_and_tournamentStartDate", (q) =>
        q.eq("userId", userId).eq("entryStatus", "confirmed"),
      )
      .order("desc")
      .take(limit);
  }
  const sameStartDate = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_userId_and_entryStatus_and_tournamentStartDate", (q) =>
      q
        .eq("userId", userId)
        .eq("entryStatus", "confirmed")
        .eq("tournamentStartDate", position.startDate)
        .lt("_creationTime", position.creationTime),
    )
    .order("desc")
    .take(limit);
  if (sameStartDate.length >= limit) {
    return sameStartDate;
  }
  const olderStartDates = await ctx.db
    .query("tournamentRegistrations")
    .withIndex("by_userId_and_entryStatus_and_tournamentStartDate", (q) =>
      q
        .eq("userId", userId)
        .eq("entryStatus", "confirmed")
        .lt("tournamentStartDate", position.startDate),
    )
    .order("desc")
    .take(limit - sameStartDate.length);
  return [...sameStartDate, ...olderStartDates];
}

// Every public profile query authorizes through this single gate so
// enforcement never depends on what the client already fetched. Returns null
// for unknown/malformed codes and for private profiles viewed by anyone but
// their owner — the two cases are deliberately indistinguishable to callers.
export async function resolvePublicPlayer(
  ctx: QueryCtx,
  rawPublicCode: string,
) {
  const publicCode = parsePublicCode(rawPublicCode);
  if (publicCode === null) {
    return null;
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_publicCode", (q) => q.eq("publicCode", publicCode))
    .unique();
  if (!user) {
    return null;
  }

  const viewer = await currentUserOrNull(ctx);
  const isOwner = viewer?._id === user._id;
  // A missing visibility (legacy/test rows) is treated as public; only an
  // explicit "private" hides the profile. Owners always resolve their own
  // profile so they can preview what they've hidden.
  if (user.profileVisibility === "private" && !isOwner) {
    return null;
  }

  return { user, viewer, isOwner };
}

export function canViewHistory({
  user,
  isOwner,
}: {
  user: Doc<"users">;
  isOwner: boolean;
}) {
  return isOwner || user.historyVisibility !== "private";
}

// Stricter than getPublicTournament: unlisted events are link-only, and a
// profile listing that named them would hand out the very link they hide
// behind — so only "public" events show unconditionally, while unlisted and
// private ones stay visible to the viewer's own registrations and org
// memberships. The membership cache spans a results loop so several such
// events from one organization cost a single membership read.
export async function viewerCanSeeTournament(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  viewer: Doc<"users"> | null,
  membershipCache: Map<Id<"organizations">, boolean>,
) {
  if (tournament.visibility === "public" && isPubliclyViewable(tournament)) {
    return true;
  }
  if (!viewer) {
    return false;
  }

  let isMember = membershipCache.get(tournament.organizationId);
  if (isMember === undefined) {
    isMember =
      (await getActiveMembership(
        ctx,
        tournament.organizationId,
        viewer._id,
      )) !== null;
    membershipCache.set(tournament.organizationId, isMember);
  }
  if (isMember) {
    return true;
  }

  const registration = await registrationForUser(
    ctx,
    tournament._id,
    viewer._id,
  );
  return registration?.entryStatus === "confirmed";
}

// A registration contributes to a profile's history only when its tournament
// finished, is a real event, the player had a confirmed entry (dropped,
// eliminated, and disqualified players are still public record), and the
// viewer could open the tournament page themselves.
export async function qualifyingCompletedTournament(
  ctx: QueryCtx,
  registration: Doc<"tournamentRegistrations">,
  viewer: Doc<"users"> | null,
  membershipCache: Map<Id<"organizations">, boolean>,
) {
  if (registration.entryStatus !== "confirmed") {
    return null;
  }
  const tournament = await ctx.db.get(registration.tournamentId);
  if (
    !tournament ||
    tournament.lifecycle !== "completed" ||
    tournament.isTestEvent ||
    !(await viewerCanSeeTournament(ctx, tournament, viewer, membershipCache))
  ) {
    return null;
  }
  return tournament;
}

// Final placement for one player: the latest completed round's standings row.
// completeTournament requires the current round to be completed first, and
// standings rank every confirmed registration — dropped, cut, and disqualified
// players keep a row with their frozen record — so a completed tournament has
// one for every participant; a missing row is pathological
// data and renders as an unranked entry rather than dropping the tournament.
export async function finalStandingForRegistration(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  registrationId: Id<"tournamentRegistrations">,
) {
  // Later phases only have rounds once earlier ones finish, so walking the
  // phases newest-first finds the tournament's latest completed round.
  const phases = await phasesInOrder(ctx, tournamentId);
  for (const phase of [...phases].reverse()) {
    const rounds = await ctx.db
      .query("tournamentRounds")
      .withIndex("by_tournamentPhaseId_and_roundNumber", (q) =>
        q.eq("tournamentPhaseId", phase._id),
      )
      .order("desc")
      .take(MAX_ROUNDS);
    const latestCompleted = rounds.find(
      (round) => round.roundStatus === "completed",
    );
    if (!latestCompleted) {
      continue;
    }
    const standing = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_playerId", (q) =>
        q
          .eq("tournamentRoundId", latestCompleted._id)
          .eq("playerId", registrationId),
      )
      .unique();
    if (!standing) {
      return null;
    }
    return {
      rank: standing.rank,
      matchPoints: standing.matchPoints,
      matchWins: standing.matchWins,
      matchLosses: standing.matchLosses,
      matchDraws: standing.matchDraws,
    };
  }
  return null;
}

// One player's per-round results for a tournament, restricted to rounds whose
// pairings were published. Shared by the player's own history view and the
// public profile so the two surfaces cannot drift.
export async function matchLogForRegistration(
  ctx: QueryCtx,
  tournamentId: Id<"tournaments">,
  registrationId: Id<"tournamentRegistrations">,
) {
  const playerRows = await ctx.db
    .query("tournamentMatchPlayers")
    .withIndex("by_playerId", (q) => q.eq("playerId", registrationId))
    .take(MAX_MATCHES_PER_PLAYER);

  const historyRows = await mapAsyncInBatches(
    playerRows,
    DATABASE_IO_BATCH_SIZE,
    async (playerRow) => {
      const match = await ctx.db.get(playerRow.tournamentMatchId);
      if (!match || match.tournamentId !== tournamentId) {
        return null;
      }
      const round = await ctx.db.get(match.tournamentRoundId);
      if (!round || !isPairingsVisibleToPlayers(round)) {
        return null;
      }

      // Opponent names read through to the user document (not the denormalized
      // playerName) so an account without a name never leaks its email here.
      let opponentName: string | null = null;
      if (playerRow.opponentPlayerId) {
        const opponentRegistration = await ctx.db.get(
          playerRow.opponentPlayerId,
        );
        const opponentUser = opponentRegistration
          ? await ctx.db.get(opponentRegistration.userId)
          : null;
        opponentName = opponentUser?.name ?? null;
      }

      return {
        roundNumber: round.roundNumber,
        roundName: round.roundName,
        opponentName,
        isBye: playerRow.isBye,
        myGameWins: playerRow.gameWins ?? null,
        myGameLosses: playerRow.gameLosses ?? null,
        result: matchResultForRow(match, playerRow),
      };
    },
  );
  const history = historyRows.filter(
    (row): row is NonNullable<typeof row> => row !== null,
  );

  // Round numbers are global across phases, so this orders the whole
  // tournament's history.
  history.sort((left, right) => left.roundNumber - right.roundNumber);
  return history;
}

export function matchResultForRow(
  match: Doc<"tournamentMatches">,
  playerRow: Doc<"tournamentMatchPlayers">,
) {
  if (match.matchStatus !== "completed" && match.matchStatus !== "confirmed") {
    return "pending" as const;
  }
  const gameWins = playerRow.gameWins ?? 0;
  const gameLosses = playerRow.gameLosses ?? 0;
  if (playerRow.isBye || gameWins > gameLosses) {
    return "win" as const;
  }
  return gameWins < gameLosses ? ("loss" as const) : ("draw" as const);
}
