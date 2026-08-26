import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { currentUserOrNull } from "../model/access";
import { logAuditEvent } from "../model/auditLog";
import { inviteCodeGrantsAccess } from "../model/invites";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import { registrationsConcededByDrop } from "../model/matchResults";
import { ORGANIZER_LIST_PAGE_SIZE, clampPageSize } from "../model/pagination";
import {
  ensureParticipantForUser,
  participantForUser,
} from "../model/participants";
import { setRegistrationState } from "../model/participation";
import { isPaidTournament } from "../model/payments";
import { tiebreakRandom } from "../model/random";
import {
  adjustConfirmedRegistrationCount,
  entryReviewActions,
  playerDisplayName,
  registrationDropEffect,
  registrationForUser,
  registrationReinstateEffect,
  requireCapacityAvailable,
  requireRegistration,
  resolveRegistrationDisplayName,
} from "../model/registrations";
import {
  approveEntry,
  cancelEntry,
  dropPlayer,
  reinstatePlayer,
  rejectEntry,
  restoreEntry,
  waitlistEntry,
  type RosterTransitionArgs,
} from "../model/roster";
import { ensureCurrentUser } from "../model/users";
import {
  requireOrganizerAccess,
  requireTournament,
} from "../model/tournaments";
import { enforceRateLimit } from "../rateLimits";

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
      playerName: await resolveRegistrationDisplayName(
        ctx,
        registration.playerName,
        registration._id,
      ),
      // What dropRegistration would do to this row right now (null when it
      // is unavailable), so the client renders the drop action from server
      // truth instead of mirroring the lifecycle rules.
      dropEffect: registrationDropEffect(tournament.lifecycle, registration),
      // Whether that drop would also concede the row's unfinished match in
      // the open round — same predicate the drop applies, so the dialog's
      // wording always matches what confirming it will do.
      dropWouldConcede: concededByDrop.has(registration._id),
      // The entry-review actions available on this row (null when
      // unavailable), from the same projections and capacity rule the verbs
      // enforce, so the approve/reject/waitlist menu items and their wording
      // always match what confirming them will do.
      ...entryReviewActions(tournament, registration),
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
// never this mutation quietly stamping the entry confirmed.
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
  args: {
    tournamentId: v.id("tournaments"),
    inviteCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"tournamentRegistrations">> => {
    await enforceRateLimit(ctx, "registerSelf");
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    const existing = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    // A private event takes no registrations off the public page. Two grants
    // get past that: the event's invite code, which is the organizer's way of
    // letting new players in at all — and an existing row, because a player
    // who already holds one was admitted once and still resolves the event's
    // code, so cancelling is not a one-way door out of an invite-only event:
    // the cancelled row is the standing invitation that lets them back in.
    // Nothing else slips through — every other entry status is rejected just
    // below (the invite code included: it grants entry, it never overturns an
    // entry decision such as a rejection), so a live row can only ever
    // re-enter the event it belongs to.
    if (
      tournament.lifecycle !== "registration" ||
      (tournament.visibility === "private" &&
        existing === null &&
        !(await inviteCodeGrantsAccess(ctx, tournament, args.inviteCode)))
    ) {
      throw new Error("Tournament is not open for registration");
    }
    // Direct registration on a paid event goes through the Checkout action
    // (payments/checkout.ts), which files the pending row itself; the seat
    // is only ever taken by the payment webhook. Approval-mode paid events
    // still file their free application here — payment is requested at
    // approval.
    if (
      isPaidTournament(tournament) &&
      !tournament.registrationRequiresApproval
    ) {
      throw new Error(
        "This event charges an entry fee — register through the payment checkout",
      );
    }

    if (existing) {
      const blockedBecause = existingEntryBlocksRegistration(
        existing.entryStatus,
      );
      if (blockedBecause !== null) {
        throw new Error(blockedBecause);
      }
    }

    // Applications are capacity-gated like direct registrations: a full
    // event takes no more entries in either mode. (Accepting applications
    // past capacity — or auto-waitlisting them — is the waitlist-promotion
    // work, not a side effect of the approval toggle.)
    requireCapacityAvailable(tournament);
    // Under organizer approval the row enters as a "pending" application —
    // no seat taken, no participation status — and the entry-review verbs
    // decide it. Re-registering a cancelled row files a fresh application
    // the same way: a released seat is no shortcut past review. One
    // admission shape serves the fresh insert and the reused row alike.
    const requiresApproval = tournament.registrationRequiresApproval;
    const admission = requiresApproval
      ? { entryStatus: "pending" as const }
      : {
          entryStatus: "confirmed" as const,
          participationStatus: "active" as const,
        };
    const now = Date.now();
    const playerName = playerDisplayName(user);
    const participant = await ensureParticipantForUser(ctx, user._id);
    const registrationId =
      existing?._id ??
      (await ctx.db.insert("tournamentRegistrations", {
        tournamentId: args.tournamentId,
        participantId: participant._id,
        tournamentStartDate: tournament.startDate,
        ...admission,
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
        ...admission,
        playerName,
        tournamentStartDate: tournament.startDate,
        updatedAt: now,
      });
    }
    if (!requiresApproval) {
      await adjustConfirmedRegistrationCount(ctx, tournament, 1, now);
    }
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "player",
      event: {
        type: requiresApproval ? "registration_requested" : "player_registered",
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

    return await registrationForUser(ctx, args.tournamentId, user._id);
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
    // Pending and waitlisted applications are included too: an open
    // application is the only pointer the player holds to an event that has
    // not admitted them yet, so it must stay findable while it awaits
    // review. Rejected and cancelled rows stay out — neither is a live
    // entry.
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
    const registrations = (
      await Promise.all(
        (["confirmed", "pending", "waitlisted"] as const).map((entryStatus) =>
          ctx.db
            .query("tournamentRegistrations")
            .withIndex(
              "by_participantId_and_entryStatus_and_tournamentStartDate",
              (q) =>
                q
                  .eq("participantId", participant._id)
                  .eq("entryStatus", entryStatus),
            )
            .order("desc")
            .take(100),
        ),
      )
    ).flat();

    const joined = await mapAsyncInBatches(
      registrations,
      DATABASE_IO_BATCH_SIZE,
      async (registration) => {
        const tournament = await ctx.db.get(registration.tournamentId);
        if (
          !tournament ||
          (tournament.lifecycle !== "registration" &&
            tournament.lifecycle !== "in_progress")
        ) {
          return null;
        }
        const organization = await ctx.db.get(tournament.organizationId);
        return {
          registration,
          tournament,
          organizationName: organization?.name ?? null,
          registeredCount: tournament.confirmedRegistrationCount,
        };
      },
    );
    const rows = [];
    for (const row of joined) {
      if (row !== null) {
        rows.push(row);
      }
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
          ORGANIZER_LIST_PAGE_SIZE,
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
      .take(ORGANIZER_LIST_PAGE_SIZE);

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
// the state write, the seat counter, and the audit event; the three
// endpoints differ only in the verb, so one adapter serves them all. Roster
// management deliberately carries no rate limit — see rateLimits.ts.

const entryReviewMutation = (
  verb: (ctx: MutationCtx, args: RosterTransitionArgs) => Promise<void>,
) =>
  mutation({
    args: { registrationId: v.id("tournamentRegistrations") },
    handler: async (ctx, args) => {
      const registration = await requireRegistration(ctx, args.registrationId);
      const { tournament, user } = await requireOrganizerAccess(
        ctx,
        registration.tournamentId,
      );
      await verb(ctx, {
        tournament,
        registration,
        actor: user,
        actorRole: "organizer",
      });
      return args.registrationId;
    },
  });

export const approveRegistration = entryReviewMutation(approveEntry);
export const rejectRegistration = entryReviewMutation(rejectEntry);
export const waitlistRegistration = entryReviewMutation(waitlistEntry);

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
