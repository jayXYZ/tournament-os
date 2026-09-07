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
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import { registrationsConcededByDrop } from "../model/matchResults";
import { ORGANIZER_LIST_PAGE_SIZE, clampPageSize } from "../model/pagination";
import { participantForUser } from "../model/participants";
import { isPaidEvent, latestOrderForRegistration } from "../model/payments";
import {
  entryReviewActions,
  registrationDropEffect,
  registrationForUser,
  registrationReinstateEffect,
  requireRegistration,
  resolveRegistrationDisplayName,
} from "../model/registrations";
import {
  approveEntry,
  registerPlayer,
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
      // The row's payment state on paid events (the newest order's status;
      // null on free events or when the player has no order yet).
      paymentStatus: isPaidEvent(tournament)
        ? ((await latestOrderForRegistration(ctx, registration._id))?.status ??
          null)
        : null,
    }),
  );
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
    return await registerPlayer(ctx, {
      tournament,
      user,
      inviteCode: args.inviteCode,
    });
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
