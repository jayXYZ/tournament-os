import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query, type QueryCtx } from "../_generated/server";
import { currentUserOrNull } from "../model/access";
import { auditPlayerRef, logAuditEvent } from "../model/auditLog";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import { concedeUnfinishedMatchOnDrop } from "../model/matchResults";
import { clampPageSize } from "../model/pagination";
import { setRegistrationState } from "../model/participation";
import { tiebreakRandom } from "../model/random";
import {
  adjustConfirmedRegistrationCount,
  playerDisplayName,
  playerVisibleRegistration,
  registrationDropEffect,
  registrationForUser,
  requireCapacityAvailable,
  requireRegistration,
} from "../model/registrations";
import { ensureCurrentUser } from "../model/users";
import {
  requireOrganizerAccess,
  requireTournament,
} from "../model/tournaments";
import { enforceRateLimit } from "../rateLimits";

const REGISTRATION_PAGE_SIZE = 100;

async function registrationRows(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  registrations: Array<Doc<"tournamentRegistrations">>,
) {
  // Names come from the denormalized copy on the registration; only rows
  // missing it (legacy data) fall back to a live user lookup, so the common
  // path does zero per-row joins.
  return await mapAsyncInBatches(
    registrations,
    DATABASE_IO_BATCH_SIZE,
    async (registration) => ({
      registration,
      playerName:
        registration.playerName ??
        playerDisplayName(await ctx.db.get(registration.userId)),
      // What dropRegistration would do to this row right now (null when it
      // is unavailable), so the client renders the drop action from server
      // truth instead of mirroring the lifecycle rules.
      dropEffect: registrationDropEffect(tournament.lifecycle, registration),
    }),
  );
}

// What finding an existing registration row means for a new registerSelf
// attempt, per entry status: the error that blocks it, or null for
// "cancelled" — the one state whose released seat the re-registration path
// reuses. The reserved review-flow states (pending/waitlisted/rejected — see
// tournamentEntryStatusValidator; no writer exists yet) each get their own
// honest message rather than a blanket "Already registered": a pending or
// waitlisted row is a live application a second submission would duplicate,
// and a rejected row records an organizer decision that silently
// re-registering would overturn with one click — the way back from a
// rejection is a deliberate future path (organizer reversal or an explicit
// reapply), never this mutation quietly stamping the entry confirmed.
function existingEntryBlocksRegistration(
  entryStatus: Doc<"tournamentRegistrations">["entryStatus"],
): string | null {
  switch (entryStatus) {
    case "confirmed":
      return "Already registered";
    case "pending":
      return "Your registration is pending review";
    case "waitlisted":
      return "You are on the waitlist for this event";
    case "rejected":
      return "Your registration was declined";
    case "cancelled":
      return null;
    default:
      // A new entry status must decide what registerSelf does with it: the
      // `satisfies never` fails the build until this switch handles it, and
      // this throw catches a rogue runtime value.
      throw new Error(
        `Unhandled registration entry status: ${entryStatus satisfies never}`,
      );
  }
}

export const registerSelf = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<Id<"tournamentRegistrations">> => {
    await enforceRateLimit(ctx, "registerSelf");
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    const existing = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    // A private event takes no registrations off the public page, but a player
    // who already holds a row for it was admitted once and still resolves its
    // code, so cancelling is not a one-way door out of an invite-only event:
    // the cancelled row is the standing invitation that lets them back in.
    // Nothing else slips through — every other entry status is rejected just
    // below, so a live row can only ever re-enter the event it belongs to.
    if (
      tournament.lifecycle !== "registration" ||
      (tournament.visibility === "private" && existing === null)
    ) {
      throw new Error("Tournament is not open for registration");
    }

    if (existing) {
      const blockedBecause = existingEntryBlocksRegistration(
        existing.entryStatus,
      );
      if (blockedBecause !== null) {
        throw new Error(blockedBecause);
      }
    }

    requireCapacityAvailable(tournament);
    const now = Date.now();
    const playerName = playerDisplayName(user);
    const registrationId =
      existing?._id ??
      (await ctx.db.insert("tournamentRegistrations", {
        tournamentId: args.tournamentId,
        userId: user._id,
        tournamentStartDate: tournament.startDate,
        entryStatus: "confirmed",
        participationStatus: "active",
        playerName,
        createdAt: now,
        tiebreakRandom: tiebreakRandom(
          tournament.seed ?? tournament.publicCode,
          String(user.publicCode),
        ),
        updatedAt: now,
      }));
    if (existing) {
      await setRegistrationState(ctx, existing._id, {
        entryStatus: "confirmed",
        participationStatus: "active",
        playerName,
        tournamentStartDate: tournament.startDate,
        updatedAt: now,
      });
    }
    await adjustConfirmedRegistrationCount(ctx, tournament, 1, now);
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "player",
      event: {
        type: "player_registered",
        player: { registrationId, playerName: playerName ?? null },
      },
    });
    return registrationId;
  },
});

export const cancelMyRegistration = mutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "cancelRegistration");
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    if (tournament.lifecycle !== "registration") {
      throw new Error("Tournament is not open for registration");
    }
    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (
      !registration ||
      registration.entryStatus !== "confirmed" ||
      // Dropped rows are also accepted: a withdrawal preserved by a round-one
      // rewind still holds the player's seat, and cancelling releases it so
      // they can later re-register if they change their mind.
      (registration.participationStatus !== "active" &&
        registration.participationStatus !== "dropped")
    ) {
      throw new Error("Active registration not found");
    }

    const now = Date.now();
    await setRegistrationState(ctx, registration._id, {
      entryStatus: "cancelled",
      updatedAt: now,
    });
    await adjustConfirmedRegistrationCount(ctx, tournament, -1, now);
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "player",
      event: {
        type: "registration_cancelled",
        player: auditPlayerRef(registration),
      },
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

    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    return registration === null
      ? null
      : playerVisibleRegistration(registration);
  },
});

export const listMyTournaments = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserOrNull(ctx);
    if (!user) {
      return [];
    }

    // Every confirmed seat, whatever its participation status: a player who
    // was dropped, eliminated, or disqualified mid-event still holds their
    // seat and the player controller still admits them (its gate is
    // entryStatus === "confirmed"), so this listing must keep the event
    // discoverable while it runs. Filtering to active here would leave a cut
    // player with no route back to their standings and match history.
    //
    // Ordered by start date descending rather than by participation status:
    // the status index groups every "active" row (which completed events keep
    // forever) ahead of the "eliminated"/"dropped" ones, so a player with a
    // long history would spend the whole take on finished events and never
    // reach the running one they were cut from. Live and upcoming events have
    // the newest start dates, so they lead here.
    const registrations = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_userId_and_entryStatus_and_tournamentStartDate", (q) =>
        q.eq("userId", user._id).eq("entryStatus", "confirmed"),
      )
      .order("desc")
      .take(100);

    const rows = [];
    for (const registration of registrations) {
      const tournament = await ctx.db.get(registration.tournamentId);
      if (
        !tournament ||
        (tournament.lifecycle !== "registration" &&
          tournament.lifecycle !== "in_progress")
      ) {
        continue;
      }
      const organization = await ctx.db.get(tournament.organizationId);
      rows.push({
        registration: playerVisibleRegistration(registration),
        tournament,
        organizationName: organization?.name ?? null,
        registeredCount: tournament.confirmedRegistrationCount,
      });
    }

    rows.sort(
      (left, right) => left.tournament.startDate - right.tournament.startDate,
    );
    return rows;
  },
});

// Every registration workflow record, newest first. Unlike confirmed
// participants, pending/cancelled/rejected rows are not bounded by tournament
// capacity, so this organizer history must be cursor-paginated.
export const listRegistrationPage = query({
  args: {
    tournamentId: v.id("tournaments"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    // Prefix query on the compound index; the startDate column is constant
    // per tournament (reschedule syncs excepted, transiently), so this still
    // reads newest-registration-first.
    // No maximumRowsRead: this walk is a plain index-equality prefix with no
    // post-index filter, so every row read is a row returned. A cap here
    // would buy no headroom — it would just equal numItems and trip on every
    // full page (rowsRead reaches the cap on the same doc that fills the
    // page), flagging a healthy page as SplitRequired/SplitRecommended and
    // making usePaginatedQuery split and re-issue it instead of settling.
    const page = await ctx.db
      .query("tournamentRegistrations")
      .withIndex("by_tournamentId_and_tournamentStartDate", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: clampPageSize(
          args.paginationOpts.numItems,
          REGISTRATION_PAGE_SIZE,
        ),
      });

    return {
      ...page,
      page: await registrationRows(ctx, tournament, page.page),
    };
  },
});

// Organizer roster search across the full registration history. The search
// index prefix-matches the last term, which suits name-as-you-type, and
// results are relevance-ordered and bounded to one page — the client never
// has to page older records in to find a player. Rows without a denormalized
// playerName (legacy data) are absent from the index and cannot match.
export const searchRegistrations = query({
  args: { tournamentId: v.id("tournaments"), search: v.string() },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const matches = await ctx.db
      .query("tournamentRegistrations")
      .withSearchIndex("search_playerName", (q) =>
        q
          .search("playerName", args.search)
          .eq("tournamentId", args.tournamentId),
      )
      .take(REGISTRATION_PAGE_SIZE);

    return await registrationRows(ctx, tournament, matches);
  },
});

export const dropRegistration = mutation({
  args: { registrationId: v.id("tournamentRegistrations") },
  handler: async (ctx, args) => {
    const registration = await requireRegistration(ctx, args.registrationId);
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      registration.tournamentId,
    );
    if (
      tournament.lifecycle !== "registration" &&
      tournament.lifecycle !== "in_progress"
    ) {
      throw new Error("Tournament is no longer accepting roster changes");
    }
    const now = Date.now();
    const dropEffect = registrationDropEffect(
      tournament.lifecycle,
      registration,
    );
    if (dropEffect === null) {
      throw new Error("Registration cannot be dropped in its current state");
    }
    const beforePlay = dropEffect === "cancel";
    await setRegistrationState(
      ctx,
      args.registrationId,
      beforePlay
        ? { entryStatus: "cancelled", updatedAt: now }
        : {
            entryStatus: "confirmed",
            participationStatus: "dropped",
            // setRegistrationState keeps an eliminated player's elimination
            // record, so reinstating them cannot return them to active play.
            updatedAt: now,
          },
    );
    if (beforePlay) {
      await adjustConfirmedRegistrationCount(ctx, tournament, -1, now);
    }
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "organizer",
      event: {
        type: beforePlay ? "registration_cancelled" : "player_dropped",
        player: auditPlayerRef(registration),
      },
    });
    if (!beforePlay) {
      // A mid-play drop during the player's own unfinished match concedes it
      // (see CONTEXT.md "Concession"), recorded with the organizer as actor.
      await concedeUnfinishedMatchOnDrop(ctx, {
        tournament,
        registration,
        actor: user,
        actorRole: "organizer",
      });
    }
    return args.registrationId;
  },
});

export const reinstateRegistration = mutation({
  args: { registrationId: v.id("tournamentRegistrations") },
  handler: async (ctx, args) => {
    const registration = await requireRegistration(ctx, args.registrationId);
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      registration.tournamentId,
    );
    const restoringCancelledEntry =
      tournament.lifecycle === "registration" &&
      registration.entryStatus === "cancelled";
    // Dropped participants normally exist mid-play, but a round-one rewind
    // preserves withdrawals into the reopened registration lifecycle, so both
    // lifecycles must offer the way back to active play.
    const restoringDroppedParticipant =
      (tournament.lifecycle === "registration" ||
        tournament.lifecycle === "in_progress") &&
      registration.entryStatus === "confirmed" &&
      registration.participationStatus === "dropped";
    if (!restoringCancelledEntry && !restoringDroppedParticipant) {
      throw new Error("Registration cannot be reinstated in its current state");
    }
    if (restoringCancelledEntry) {
      requireCapacityAvailable(tournament);
    }
    const now = Date.now();
    // Reinstating undoes only the withdrawal: a player who was already
    // eliminated when they were dropped returns to eliminated, never to
    // active play mid-bracket. Before play there is no bracket — a rewind
    // back to registration deletes every round and clears the eliminations it
    // preserved — so the restoration is always to active.
    const eliminatedByRoundId =
      restoringDroppedParticipant && tournament.lifecycle === "in_progress"
        ? registration.eliminatedByRoundId
        : undefined;
    await setRegistrationState(
      ctx,
      args.registrationId,
      eliminatedByRoundId !== undefined
        ? {
            entryStatus: "confirmed",
            participationStatus: "eliminated",
            eliminatedByRoundId,
            tournamentStartDate: tournament.startDate,
            updatedAt: now,
          }
        : {
            entryStatus: "confirmed",
            participationStatus: "active",
            tournamentStartDate: tournament.startDate,
            updatedAt: now,
          },
    );
    if (restoringCancelledEntry) {
      await adjustConfirmedRegistrationCount(ctx, tournament, 1, now);
    }
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "organizer",
      event: {
        type: "player_reinstated",
        player: auditPlayerRef(registration),
      },
    });
    return args.registrationId;
  },
});
