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
import { userError } from "../model/errors";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import { registrationsConcededByDrop } from "../model/matchResults";
import { ORGANIZER_LIST_PAGE_SIZE, requirePageSize } from "../model/pagination";
import { participantForUser } from "../model/participants";
import { isPaidEvent } from "../model/payments";
import {
  entryReviewActions,
  paginateRegistrationHistory,
  pendingReviewCount,
  registrationDropEffect,
  registrationForUser,
  registrationOrganizerLabel,
  registrationReinstateEffect,
  requireRegistration,
  searchRegistrationHistory,
} from "../model/registrations";
import {
  approveEntry,
  cancelEntry,
  dropPlayer,
  enrollPlayer as enrollPlayerEntry,
  registerEntry,
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
import {
  paymentOrderStatusValidator,
  registrationFilterValidator,
} from "../validators";

async function registrationRows(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  registrations: Array<Doc<"tournamentRegistrations">>,
) {
  // One open-round scan serves every row's concession fact below.
  const concededByDrop = await registrationsConcededByDrop(ctx, tournament);
  // Names come straight off the registration's stamps — no per-row read at
  // all. Organizer-only surface: a nameless account is labelled by its
  // email (registrationOrganizerLabel).
  return registrations.map((registration) => ({
    registration,
    playerName: registrationOrganizerLabel(registration),
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
    // The row's payment state on paid events: the newest order's status,
    // read from the mirror every order write maintains (schema.ts
    // tournamentRegistrations.paymentStatus) rather than a per-row order
    // lookup; null on free events or when the player has no order yet.
    paymentStatus: isPaidEvent(tournament)
      ? (registration.paymentStatus ?? null)
      : null,
  }));
}

// A thin adapter: the rate limit and the caller's account, then the roster
// verb (model/roster.ts registerEntry) owns the entry gates, the write, the
// seat counter, and the audit event.
export const registerSelf = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    inviteCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"tournamentRegistrations">> => {
    await enforceRateLimit(ctx, "registerSelf");
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    return await registerEntry(ctx, {
      tournament,
      user,
      inviteCode: args.inviteCode,
    });
  },
});

// The organizer's direct enrollment of a player by name or email, without
// an account (CONTEXT.md "Enrollment"): a thin adapter — the rate limit
// (enrollment mints guest rows, see rateLimits.ts) and organizer access —
// over the roster verb (model/roster.ts enrollPlayer), which owns the input
// rules, the identity resolution, the entry gates, the write, the seat
// counter, and the audit event.
export const enrollPlayer = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    displayName: v.string(),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"tournamentRegistrations">> => {
    await enforceRateLimit(ctx, "enrollPlayer");
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      args.tournamentId,
    );
    return await enrollPlayerEntry(ctx, {
      tournament,
      actor: user,
      displayName: args.displayName,
      email: args.email,
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
      throw userError("Active registration not found");
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

// Every registration workflow record, newest first — or, under a filter,
// one slice of it: an entry status, or the review queue (see
// registrationFilterValidator). Unlike confirmed participants,
// pending/cancelled/rejected rows are not bounded by tournament capacity, so
// this organizer history must be cursor-paginated;
// paginateRegistrationHistory picks the index. The optional payment filter
// (any of the given order statuses, matched against the row's mirrored
// paymentStatus) narrows on the server too, so a filtered page never omits
// a match that merely sat on a later page — within a per-page row budget: a
// page that exhausts it comes back short with a split required, and the
// client pages on through the next window (see paginateRegistrationHistory).
export const listRegistrationPage = query({
  args: {
    tournamentId: v.id("tournaments"),
    filter: v.optional(registrationFilterValidator),
    payment: v.optional(v.array(paymentOrderStatusValidator)),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    requirePageSize(args.paginationOpts.numItems, ORGANIZER_LIST_PAGE_SIZE);
    const page = await paginateRegistrationHistory(
      ctx,
      args.tournamentId,
      args.filter,
      args.paginationOpts,
      args.payment,
    );
    return {
      ...page,
      page: await registrationRows(ctx, tournament, page.page),
    };
  },
});

// The Registrations tab's notification count: how many applications await a
// decision, so an organizer sees there is review work from anywhere in the
// manager without opening the tab (see pendingReviewCount for the cap and
// the lifecycle rule).
export const getPendingReviewCount = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    return await pendingReviewCount(ctx, tournament);
  },
});

// Organizer roster search across the full registration history, one page of
// best matches; the optional filters compose with the search the same way
// they narrow the list (see searchRegistrationHistory).
export const searchRegistrations = query({
  args: {
    tournamentId: v.id("tournaments"),
    search: v.string(),
    filter: v.optional(registrationFilterValidator),
    payment: v.optional(v.array(paymentOrderStatusValidator)),
  },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const matches = await searchRegistrationHistory(
      ctx,
      args.tournamentId,
      args.search,
      args.filter,
      args.payment,
    );

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
      throw userError("Tournament is no longer accepting roster changes");
    }
    const dropEffect = registrationDropEffect(
      tournament.lifecycle,
      registration,
    );
    if (dropEffect === null) {
      throw userError("Registration cannot be dropped in its current state");
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
      throw userError("Registration cannot be reinstated in its current state");
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
