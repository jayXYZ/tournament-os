import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { mutation, query, type QueryCtx } from "../_generated/server";
import { currentUserOrNull } from "../model/access";
import { logAuditEvent } from "../model/auditLog";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import { registrationsConcededByDrop } from "../model/matchResults";
import { clampPageSize } from "../model/pagination";
import {
  ensureParticipantForUser,
  participantForUser,
} from "../model/participants";
import { setRegistrationState } from "../model/participation";
import { tiebreakRandom } from "../model/random";
import {
  adjustConfirmedRegistrationCount,
  playerDisplayName,
  playerVisibleRegistration,
  registrationDisplayName,
  registrationDropEffect,
  registrationForUser,
  registrationReinstateEffect,
  requireCapacityAvailable,
  requireRegistration,
} from "../model/registrations";
import {
  approveEntry,
  cancelEntry,
  dropPlayer,
  reinstatePlayer,
  rejectEntry,
  restoreEntry,
  waitlistEntry,
} from "../model/roster";
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
  // One open-round scan serves every row's concession fact below.
  const concededByDrop = await registrationsConcededByDrop(ctx, tournament);
  // Names come from the denormalized copy on the registration; only rows
  // missing it fall back to a live identity lookup, so the common path does
  // zero per-row joins.
  return await mapAsyncInBatches(
    registrations,
    DATABASE_IO_BATCH_SIZE,
    async (registration) => ({
      registration,
      playerName:
        registration.playerName ??
        (await registrationDisplayName(ctx, registration._id)),
      // What dropRegistration would do to this row right now (null when it
      // is unavailable), so the client renders the drop action from server
      // truth instead of mirroring the lifecycle rules.
      dropEffect: registrationDropEffect(tournament.lifecycle, registration),
      // Whether that drop would also concede the row's unfinished match in
      // the open round — same predicate the drop applies, so the dialog's
      // wording always matches what confirming it will do.
      dropWouldConcede: concededByDrop.has(registration._id),
    }),
  );
}

// What finding an existing registration row means for a new registerSelf
// attempt, per entry status: the error that blocks it, or null for
// "cancelled" — the one state whose released seat the re-registration path
// reuses. The review-flow states (pending/waitlisted/rejected) each get
// their own honest message rather than a blanket "Already registered": a
// pending or waitlisted row is a live application a second submission would
// duplicate, and a rejected row records an organizer decision that silently
// re-registering would overturn with one click — the way back from a
// rejection is approveEntry (the organizer reversal in model/roster.ts),
// never this mutation quietly stamping the entry confirmed. Nothing creates
// pending or waitlisted rows yet; the transitions out of them exist so the
// admission-mode work only has to add the way in.
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
    const participant = await ensureParticipantForUser(ctx, user._id);
    const registrationId =
      existing?._id ??
      (await ctx.db.insert("tournamentRegistrations", {
        tournamentId: args.tournamentId,
        participantId: participant._id,
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
    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (!registration) {
      throw new Error("Active registration not found");
    }
    await cancelEntry(ctx, {
      tournament,
      registration,
      actor: user,
      actorRole: "player",
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
    const participant = await participantForUser(ctx, user._id);
    if (!participant) {
      return [];
    }
    const registrations = await ctx.db
      .query("tournamentRegistrations")
      .withIndex(
        "by_participantId_and_entryStatus_and_tournamentStartDate",
        (q) =>
          q.eq("participantId", participant._id).eq("entryStatus", "confirmed"),
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
    const dropEffect = registrationDropEffect(
      tournament.lifecycle,
      registration,
    );
    if (dropEffect === null) {
      throw new Error("Registration cannot be dropped in its current state");
    }
    // Before play the roster's drop action releases the seat; in play it
    // drops the player (see registrationDropEffect) — one button, two verbs.
    if (dropEffect === "cancel") {
      await cancelEntry(ctx, {
        tournament,
        registration,
        actor: user,
        actorRole: "organizer",
      });
    } else {
      await dropPlayer(ctx, {
        tournament,
        registration,
        actor: user,
        actorRole: "organizer",
      });
    }
    return args.registrationId;
  },
});

// The organizer entry-review actions. Like dropRegistration and
// reinstateRegistration these are thin adapters over the roster verbs, which
// own eligibility (via the effect projections in model/registrations.ts),
// the state write, the seat counter, and the audit event. Roster management
// deliberately carries no rate limit — see rateLimits.ts.

export const approveRegistration = mutation({
  args: { registrationId: v.id("tournamentRegistrations") },
  handler: async (ctx, args) => {
    const registration = await requireRegistration(ctx, args.registrationId);
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      registration.tournamentId,
    );
    await approveEntry(ctx, {
      tournament,
      registration,
      actor: user,
      actorRole: "organizer",
    });
    return args.registrationId;
  },
});

export const rejectRegistration = mutation({
  args: { registrationId: v.id("tournamentRegistrations") },
  handler: async (ctx, args) => {
    const registration = await requireRegistration(ctx, args.registrationId);
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      registration.tournamentId,
    );
    await rejectEntry(ctx, {
      tournament,
      registration,
      actor: user,
      actorRole: "organizer",
    });
    return args.registrationId;
  },
});

export const waitlistRegistration = mutation({
  args: { registrationId: v.id("tournamentRegistrations") },
  handler: async (ctx, args) => {
    const registration = await requireRegistration(ctx, args.registrationId);
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      registration.tournamentId,
    );
    await waitlistEntry(ctx, {
      tournament,
      registration,
      actor: user,
      actorRole: "organizer",
    });
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
    const reinstateEffect = registrationReinstateEffect(
      tournament.lifecycle,
      registration,
    );
    if (reinstateEffect === null) {
      throw new Error("Registration cannot be reinstated in its current state");
    }
    if (reinstateEffect === "restore") {
      await restoreEntry(ctx, {
        tournament,
        registration,
        actor: user,
        actorRole: "organizer",
      });
    } else {
      await reinstatePlayer(ctx, {
        tournament,
        registration,
        actor: user,
        actorRole: "organizer",
      });
    }
    return args.registrationId;
  },
});
