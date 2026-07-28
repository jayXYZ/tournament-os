import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireIdentity } from "./auth";
import { clampPageSize } from "./model/pagination";
import {
  MAX_PROFILE_RESULTS_PAGE_SIZE,
  canViewHistory,
  finalStandingForRegistration,
  matchLogForRegistration,
  qualifyingCompletedTournament,
  resolvePublicPlayer,
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

// Past tournament results for a profile page. Pages with .paginate() so
// reactive re-runs keep the client's journal-pinned page boundaries (rows
// appearing or disappearing between loaded pages can't be skipped or shown
// twice) and malformed cursors surface as Convex InvalidCursor errors, which
// usePaginatedQuery answers by resetting instead of crashing. Visibility is
// applied per row AFTER pagination, so hidden registrations shrink their page
// — possibly to empty — rather than being topped up; usePaginatedQuery
// handles short pages, and Convex cursors are opaque, so a boundary that
// lands on a hidden row reveals nothing about it. Note this means a returned
// page can be entirely empty while `isDone` is still false (a hollow page) —
// callers (see TournamentHistory in user-public-page.tsx) must keep loading
// further pages rather than rendering the empty page as "no history".
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

    const paginated = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_userId_and_entryStatus_and_tournamentStartDate", (q) =>
        q.eq("userId", user._id).eq("entryStatus", "confirmed"),
      )
      .order("desc")
      .paginate({ ...args.paginationOpts, numItems });

    const membershipCache = new Map<Id<"organizations">, boolean>();
    const results = [];
    for (const registration of paginated.page) {
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
    }

    // Spread keeps the paginate contract's extra fields (splitCursor,
    // pageStatus) intact for the client's page-splitting machinery.
    return { ...paginated, page: results };
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
