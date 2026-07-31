import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireIdentity } from "./auth";
import { clampPageSize } from "./model/pagination";
import {
  MAX_PROFILE_RESULTS_PAGE_SIZE,
  PROFILE_RESULTS_RAW_READ_BUDGET,
  canViewHistory,
  decodeProfileResultsCursor,
  encodeProfileResultsCursor,
  finalStandingForRegistration,
  matchLogForRegistration,
  qualifyingCompletedTournament,
  resolvePublicPlayer,
  takeConfirmedRegistrationsAfter,
} from "./model/playerResults";
import {
  playerVisibleParticipationStatus,
  registrationForUser,
} from "./model/registrations";
import { ensureCurrentUser, userByTokenIdentifier } from "./model/users";
import { userProfileVisibilityValidator } from "./validators";

export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    return await userByTokenIdentifier(ctx, identity.tokenIdentifier);
  },
});

export const upsertMe = mutation({
  args: {},
  handler: async (ctx): Promise<Id<"users">> => {
    const user = await ensureCurrentUser(ctx);
    return user._id;
  },
});

export const updateMyProfileSettings = mutation({
  args: {
    profileVisibility: v.optional(userProfileVisibilityValidator),
    historyVisibility: v.optional(userProfileVisibilityValidator),
  },
  handler: async (ctx, args) => {
    const user = await ensureCurrentUser(ctx);
    await ctx.db.patch(user._id, {
      ...(args.profileVisibility !== undefined
        ? { profileVisibility: args.profileVisibility }
        : {}),
      ...(args.historyVisibility !== undefined
        ? { historyVisibility: args.historyVisibility }
        : {}),
      updatedAt: Date.now(),
    });
    return user._id;
  },
});

// Resolves a player's public code (from a profile URL) to the fields that are
// safe to show publicly. Takes the code as a string because it arrives from the
// URL; unknown or malformed codes return null instead of throwing, as do
// private profiles viewed by anyone but their owner (indistinguishable by
// design — see resolvePublicPlayer). Email and the Convex id are intentionally
// omitted. Owners always resolve their own profile; profileHidden tells the UI
// to explain that nobody else can see it.
export const getPublicPlayer = query({
  args: { publicCode: v.string() },
  handler: async (ctx, args) => {
    const resolved = await resolvePublicPlayer(ctx, args.publicCode);
    if (!resolved) {
      return null;
    }
    const { user, isOwner } = resolved;

    return {
      publicCode: user.publicCode,
      name: user.name ?? null,
      avatarUrl: user.avatarUrl ?? null,
      isOwner,
      profileHidden: user.profileVisibility === "private",
      // historyVisible is viewer-relative (owners always see their own
      // history); historyHidden reports the underlying setting so the owner's
      // page can explain that others can't see it. For non-owners the two are
      // simply inverses, so this reveals nothing new.
      historyVisible: canViewHistory(resolved),
      historyHidden: user.historyVisibility === "private",
    };
  },
});

// Past tournament results for a profile page. Rows the viewer can't see
// (in-progress events, test events, private/unlisted tournaments without
// their own access — see qualifyingCompletedTournament, whose rules this
// query never bends) are topped up SERVER-SIDE: the handler seeks the
// registrations index itself, skipping hidden rows until the page is full,
// the index is exhausted, or PROFILE_RESULTS_RAW_READ_BUDGET raw rows have
// been examined. The paging contract callers get:
//   - a non-empty page: up to numItems visible results, newest first;
//   - an empty page with isDone: true — the history is truly exhausted;
//   - an empty page with isDone: false — ONLY when the read budget ran out
//     inside an all-hidden stretch; continueCursor has then advanced past
//     every examined row, so simply loading more always makes budget-sized
//     progress and terminates (see TournamentHistory in user-public-page.tsx).
// Convex permits one .paginate() per query, so the top-up loop uses an
// explicit cursor (encoded index position) instead of the native paginate
// cursor. Trade-off: no query journal, so reactive re-runs don't pin loaded
// page boundaries — a row completing mid-session can transiently vanish or
// duplicate at a boundary until pagination resets. Completed-tournament
// history churns rarely, and in exchange every consumer (web today, native
// next) gets "empty means done" without client-side compensation loops.
// Malformed cursors throw the InvalidCursor handshake usePaginatedQuery
// answers by resetting.
export const getPublicPlayerResults = query({
  args: {
    publicCode: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const resolved = await resolvePublicPlayer(ctx, args.publicCode);
    if (!resolved || !canViewHistory(resolved)) {
      return {
        page: [],
        isDone: true,
        continueCursor: "",
      };
    }
    const { user, viewer } = resolved;

    const numItems = clampPageSize(
      args.paginationOpts.numItems,
      MAX_PROFILE_RESULTS_PAGE_SIZE,
    );
    let position =
      args.paginationOpts.cursor === null
        ? null
        : decodeProfileResultsCursor(args.paginationOpts.cursor);

    const membershipCache = new Map<Id<"organizations">, boolean>();
    const results = [];
    let rowsExamined = 0;
    let exhausted = false;
    // Batches start at the requested page size (the common case: everything
    // visible, one batch) and double after each miss so a hidden stretch
    // costs O(log budget) index seeks rather than one per page-sized bite.
    let batchSize = numItems;

    while (
      results.length < numItems &&
      rowsExamined < PROFILE_RESULTS_RAW_READ_BUDGET &&
      !exhausted
    ) {
      const limit = Math.min(
        batchSize,
        PROFILE_RESULTS_RAW_READ_BUDGET - rowsExamined,
      );
      const batch = await takeConfirmedRegistrationsAfter(
        ctx,
        user._id,
        position,
        limit,
      );
      for (const registration of batch) {
        rowsExamined += 1;
        position = {
          startDate: registration.tournamentStartDate,
          creationTime: registration._creationTime,
        };
        const tournament = await qualifyingCompletedTournament(
          ctx,
          registration,
          viewer,
          membershipCache,
        );
        if (!tournament) {
          continue;
        }
        const standing = await finalStandingForRegistration(
          ctx,
          tournament._id,
          registration._id,
        );
        results.push({
          tournamentId: tournament._id,
          tournamentPublicCode: tournament.publicCode,
          tournamentName: tournament.name,
          startDate: tournament.startDate,
          format: tournament.format,
          registrationStatus:
            playerVisibleParticipationStatus(
              registration.participationStatus ?? null,
            ) ?? "active",
          finalRank: standing?.rank ?? null,
          matchPoints: standing?.matchPoints ?? 0,
          matchWins: standing?.matchWins ?? 0,
          matchLosses: standing?.matchLosses ?? 0,
          matchDraws: standing?.matchDraws ?? 0,
        });
        if (results.length >= numItems) {
          // Position sits on the last enriched row; the unprocessed tail of
          // this batch is re-read by the next page rather than skipped.
          break;
        }
      }
      // Reaching here without a full page means the whole batch was
      // processed, so a short batch proves the index holds nothing further.
      if (results.length < numItems && batch.length < limit) {
        exhausted = true;
      }
      batchSize = Math.min(batchSize * 2, PROFILE_RESULTS_RAW_READ_BUDGET);
    }

    return {
      page: results,
      isDone: exhausted,
      continueCursor:
        position === null ? "" : encodeProfileResultsCursor(position),
    };
  },
});

// Per-round match log for one tournament on a profile page, loaded when the
// viewer expands that tournament's card. Re-runs the full privacy gate rather
// than trusting that the client obtained the tournamentId from
// getPublicPlayerResults; any failure returns null.
export const getPublicPlayerTournamentLog = query({
  args: { publicCode: v.string(), tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const resolved = await resolvePublicPlayer(ctx, args.publicCode);
    if (!resolved || !canViewHistory(resolved)) {
      return null;
    }
    const { user, viewer } = resolved;

    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (!registration) {
      return null;
    }
    const tournament = await qualifyingCompletedTournament(
      ctx,
      registration,
      viewer,
      new Map(),
    );
    if (!tournament) {
      return null;
    }

    return await matchLogForRegistration(ctx, tournament._id, registration._id);
  },
});
