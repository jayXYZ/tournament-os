import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { mutation, query, type QueryCtx } from "../_generated/server";
import { currentUserOrNull } from "../model/access";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import {
  badgeForUser,
  cancelBadge,
  isConventionRegistrationOpen,
  registerBadge,
  removeBadge as removeBadgeVerb,
  requireBadge,
  requireConvention,
  requireConventionOrganizerAccess,
} from "../model/conventions";
import { ORGANIZER_LIST_PAGE_SIZE, clampPageSize } from "../model/pagination";
import { participantPublicIdentity } from "../model/participants";
import { latestOrderForRegistration } from "../model/payments";
import {
  isPaidTicketType,
  requireTicketTypeForConvention,
} from "../model/ticketTypes";
import { ensureCurrentUser } from "../model/users";
import { enforceRateLimit } from "../rateLimits";

// The badge registration surface, mirroring tournaments/registrations.ts in
// miniature: badges have no approval flow, waitlist, or competitive state,
// so the roster machinery reduces to register / cancel / remove plus the
// organizer's paginated roster reads.

async function badgeRows(
  ctx: QueryCtx,
  badges: Array<Doc<"conventionRegistrations">>,
) {
  // Ticket-type names for the roster: the rows map concurrently, so the
  // distinct types are prefetched up front (a page rarely spans more than
  // a handful) rather than cached lazily per row.
  const typeIds = [...new Set(badges.map((badge) => badge.ticketTypeId))];
  const typeNames = new Map(
    (
      await Promise.all(
        typeIds.map(
          async (typeId) => [typeId, await ctx.db.get(typeId)] as const,
        ),
      )
    ).map(([typeId, ticketType]) => [typeId, ticketType?.name ?? null]),
  );
  return await mapAsyncInBatches(
    badges,
    DATABASE_IO_BATCH_SIZE,
    async (badge) => {
      let playerName = badge.playerName;
      if (playerName === undefined) {
        const participant = await ctx.db.get(badge.participantId);
        playerName = participant
          ? ((await participantPublicIdentity(ctx, participant)).name ??
            undefined)
          : undefined;
      }
      return {
        registration: badge,
        playerName,
        ticketTypeName: typeNames.get(badge.ticketTypeId) ?? null,
        // A free badge simply has no orders; no per-event paid flag needed.
        paymentStatus:
          (await latestOrderForRegistration(ctx, badge._id))?.status ?? null,
      };
    },
  );
}

export const registerSelfForConvention = mutation({
  args: {
    conventionId: v.id("conventions"),
    ticketTypeId: v.id("conventionTicketTypes"),
  },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "registerSelf");
    const user = await ensureCurrentUser(ctx);
    const convention = await requireConvention(ctx, args.conventionId);
    const ticketType = await requireTicketTypeForConvention(
      ctx,
      convention,
      args.ticketTypeId,
    );
    const existing = await badgeForUser(ctx, args.conventionId, user._id);
    // A private convention takes no registrations off the public page; an
    // existing row is the standing re-admission (mirroring registerSelf,
    // minus invite codes — conventions have none in v1).
    if (
      !isConventionRegistrationOpen(convention) ||
      (convention.visibility === "private" && existing === null)
    ) {
      throw new Error("Convention registration is not open");
    }
    // A paid ticket goes through the checkout action
    // (payments/checkout.ts createBadgeCheckout); the seat is only ever
    // taken by the payment webhook.
    if (isPaidTicketType(ticketType)) {
      throw new Error(
        "This ticket has a fee — register through the payment checkout",
      );
    }
    const badge = await registerBadge(ctx, { convention, ticketType, user });
    return badge._id;
  },
});

export const cancelMyBadge = mutation({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    await enforceRateLimit(ctx, "cancelRegistration");
    const user = await ensureCurrentUser(ctx);
    const convention = await requireConvention(ctx, args.conventionId);
    const badge = await badgeForUser(ctx, args.conventionId, user._id);
    if (!badge) {
      throw new Error("No active convention registration found");
    }
    await cancelBadge(ctx, { convention, badge, actor: user });
    return badge._id;
  },
});

export const getMyBadge = query({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    const user = await currentUserOrNull(ctx);
    if (!user) {
      return null;
    }
    return await badgeForUser(ctx, args.conventionId, user._id);
  },
});

// The organizer's badge roster, newest first, cursor-paginated like the
// tournament registration history.
export const listBadgePage = query({
  args: {
    conventionId: v.id("conventions"),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireConventionOrganizerAccess(ctx, args.conventionId);
    const page = await ctx.db
      .query("conventionRegistrations")
      .withIndex("by_conventionId_and_createdAt", (q) =>
        q.eq("conventionId", args.conventionId),
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
      page: await badgeRows(ctx, page.page),
    };
  },
});

// Organizer roster search over the denormalized badge-holder name.
export const searchBadges = query({
  args: { conventionId: v.id("conventions"), search: v.string() },
  handler: async (ctx, args) => {
    await requireConventionOrganizerAccess(ctx, args.conventionId);
    const matches = await ctx.db
      .query("conventionRegistrations")
      .withSearchIndex("search_playerName", (q) =>
        q
          .search("playerName", args.search)
          .eq("conventionId", args.conventionId),
      )
      .take(ORGANIZER_LIST_PAGE_SIZE);

    return await badgeRows(ctx, matches);
  },
});

// The organizer removes a badge holder; always refunds in full with the
// organizer absorbing the processing fee (model/conventions.ts).
export const removeBadge = mutation({
  args: { registrationId: v.id("conventionRegistrations") },
  handler: async (ctx, args) => {
    const badge = await requireBadge(ctx, args.registrationId);
    const { convention, user } = await requireConventionOrganizerAccess(
      ctx,
      badge.conventionId,
    );
    await removeBadgeVerb(ctx, { convention, badge, actor: user });
    return args.registrationId;
  },
});
