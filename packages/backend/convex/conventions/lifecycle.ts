import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type QueryCtx,
} from "../_generated/server";
import { requireActiveMembership } from "../model/access";
import { logConventionAuditEvent } from "../model/auditLog";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import {
  canViewConvention,
  createConvention as createConventionModel,
  requireConventionEditable,
  requireConventionOrganizerAccess,
  requireConventionSetupEditable,
  validConventionCapacity,
  validDateRange,
} from "../model/conventions";
import { deleteConventionOperationalDataBatch } from "../model/deletion";
import { requireEventPaymentsSettled } from "../model/payments";
import { parsePublicCode } from "../model/publicCodes";
import {
  conventionHasPaidTicketType,
  listTicketTypes,
  validTicketTypeInputs,
} from "../model/ticketTypes";
import { cleanName, validDetailsMarkdown } from "../model/tournaments";
import { enforceRateLimit } from "../rateLimits";
import { tournamentVisibilityValidator } from "../validators";

// The convention lifecycle surface, mirroring tournaments/lifecycle.ts:
// thin adapters over model/conventions.ts. A convention has no rounds and
// no in_progress phase (ADR 0004), so its lifecycle moves only through
// these explicit transitions — publish opens the live run ("registration"),
// complete ends it and releases the payout, cancel refunds. What is
// purchasable inside the run is each ticket type's own sale window
// (conventions/ticketTypes.ts).

export const createConvention = mutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    startDate: v.number(),
    endDate: v.number(),
    playerCapacity: v.number(),
    isTestEvent: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<Id<"conventions">> => {
    await enforceRateLimit(ctx, "createConvention");
    return await createConventionModel(ctx, {
      organizationId: args.organizationId,
      name: args.name,
      startDate: args.startDate,
      endDate: args.endDate,
      playerCapacity: args.playerCapacity,
      isTestEvent: args.isTestEvent ?? false,
    });
  },
});

export const listForOrganization = query({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireActiveMembership(ctx, args.organizationId);

    // The composite index requires a lifecycle bound; union the arms and
    // merge-sort so the list covers every state, newest start first.
    const rows = (
      await Promise.all(
        (["setup", "registration", "completed", "cancelled"] as const).map(
          (lifecycle) =>
            ctx.db
              .query("conventions")
              .withIndex("by_organizationId_and_lifecycle_and_startDate", (q) =>
                q
                  .eq("organizationId", args.organizationId)
                  .eq("lifecycle", lifecycle),
              )
              .order("desc")
              .take(100),
        ),
      )
    ).flat();
    rows.sort((left, right) => right.startDate - left.startDate);
    return rows.slice(0, 100).map((convention) => ({
      ...convention,
      registeredCount: convention.confirmedRegistrationCount,
    }));
  },
});

export const listUpcomingPublic = query({
  args: {},
  handler: async (ctx) => {
    const conventions = await ctx.db
      .query("conventions")
      .withIndex("by_visibility_and_lifecycle_and_startDate", (q) =>
        q
          .eq("visibility", "public")
          .eq("lifecycle", "registration")
          .gte("startDate", Date.now()),
      )
      .order("asc")
      .take(100);

    return await mapAsyncInBatches(
      conventions,
      DATABASE_IO_BATCH_SIZE,
      async (convention) => {
        const organization = await ctx.db.get(convention.organizationId);
        return {
          ...convention,
          organizationName: organization?.name ?? null,
          registeredCount: convention.confirmedRegistrationCount,
        };
      },
    );
  },
});

// The convention a raw public-code string resolves to, or null for
// malformed or unknown codes.
async function conventionByPublicCode(ctx: QueryCtx, rawPublicCode: string) {
  const publicCode = parsePublicCode(rawPublicCode);
  if (publicCode === null) {
    return null;
  }
  return await ctx.db
    .query("conventions")
    .withIndex("by_publicCode", (q) => q.eq("publicCode", publicCode))
    .unique();
}

// The public convention page's read, mirroring getPublicTournament's access
// rules minus invite codes (conventions have none in v1): a private
// convention resolves only for the organizing team and badge holders
// (canViewConvention — the rule every public convention read shares).
export const getPublicConvention = query({
  args: { publicCode: v.string() },
  handler: async (ctx, args) => {
    const convention = await conventionByPublicCode(ctx, args.publicCode);
    if (!convention || !(await canViewConvention(ctx, convention))) {
      return null;
    }

    const organization = await ctx.db.get(convention.organizationId);
    return {
      convention,
      organizationName: organization?.name ?? null,
      registeredCount: convention.confirmedRegistrationCount,
    };
  },
});

// Resolves a public code to the convention an organizer manages; null for
// malformed or unknown codes, throws without organizer access.
export const getManagedConvention = query({
  args: { publicCode: v.string() },
  handler: async (ctx, args) => {
    const found = await conventionByPublicCode(ctx, args.publicCode);
    if (!found) {
      return null;
    }
    const { convention } = await requireConventionOrganizerAccess(
      ctx,
      found._id,
    );
    return { convention };
  },
});

export const updateConventionSetup = mutation({
  args: {
    conventionId: v.id("conventions"),
    name: v.optional(v.string()),
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
    playerCapacity: v.optional(v.number()),
    badgeRequiredForChildEvents: v.optional(v.boolean()),
    // Refund cutoff for player cancellations: null clears it (the default
    // then anchors to the start date — paidEntryRefundWindowOpen), a
    // timestamp at or before startDate sets it. Pricing is not here: it
    // lives on ticket types (conventions/ticketTypes.ts, ADR 0004).
    refundDeadline: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const { convention } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    requireConventionEditable(convention);

    const now = Date.now();
    const patch: Partial<Doc<"conventions">> = { updatedAt: now };
    if (args.name !== undefined) {
      patch.name = cleanName(args.name, "Convention name");
    }
    if (args.startDate !== undefined || args.endDate !== undefined) {
      // The pair validates together so a one-ended edit cannot invert the
      // range. No registration fan-out here — badges carry no denormalized
      // date copy.
      const range = validDateRange(
        args.startDate ?? convention.startDate,
        args.endDate ?? convention.endDate,
      );
      // Ticket-type windows were validated against the dates in force when
      // they were written (validTicketTypeInputs); the revised range must
      // not invalidate them after the fact — a shortened convention could
      // otherwise leave passes purchasable outside its own dates.
      const ticketTypes = await listTicketTypes(ctx, args.conventionId);
      for (const ticketType of ticketTypes) {
        try {
          validTicketTypeInputs({ ...convention, ...range }, ticketType);
        } catch (error) {
          throw new Error(
            `These dates conflict with the "${ticketType.name}" ticket (${
              error instanceof Error ? error.message : "invalid window"
            }) — edit that ticket type first`,
          );
        }
      }
      patch.startDate = range.startDate;
      patch.endDate = range.endDate;
    }
    if (args.playerCapacity !== undefined) {
      const playerCapacity = validConventionCapacity(args.playerCapacity);
      if (playerCapacity < convention.confirmedRegistrationCount) {
        throw new Error(
          "Badge capacity cannot be lower than the confirmed badge count",
        );
      }
      patch.playerCapacity = playerCapacity;
    }
    if (args.badgeRequiredForChildEvents !== undefined) {
      // The gate is checked at child-event registration time, so flipping it
      // never revokes entries already made (an admission gate, not a
      // standing entitlement).
      patch.badgeRequiredForChildEvents = args.badgeRequiredForChildEvents;
    }
    if (args.refundDeadline !== undefined) {
      // A policy input, not a price snapshot: editable while the convention
      // runs (no freeze), since refund decisions read it live.
      patch.refundDeadline = args.refundDeadline ?? undefined;
    }
    const effectiveRefundDeadline =
      args.refundDeadline !== undefined
        ? patch.refundDeadline
        : convention.refundDeadline;
    if (effectiveRefundDeadline !== undefined) {
      const effectiveStartDate = patch.startDate ?? convention.startDate;
      if (!Number.isFinite(effectiveRefundDeadline)) {
        throw new Error("Enter a valid refund deadline");
      }
      if (effectiveRefundDeadline > effectiveStartDate) {
        throw new Error(
          "Refund deadline must be at or before the convention start date",
        );
      }
    }

    await ctx.db.patch(args.conventionId, patch);
    return args.conventionId;
  },
});

// Details stay editable through the whole lifecycle except cancellation,
// matching updateTournamentDetails.
export const updateConventionDetails = mutation({
  args: {
    conventionId: v.id("conventions"),
    detailsMarkdown: v.string(),
  },
  handler: async (ctx, args) => {
    const { convention } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    if (convention.lifecycle === "cancelled") {
      throw new Error("Convention has been cancelled");
    }
    await ctx.db.patch(args.conventionId, {
      detailsMarkdown: validDetailsMarkdown(args.detailsMarkdown),
      updatedAt: Date.now(),
    });
    return args.conventionId;
  },
});

export const updateConventionVisibility = mutation({
  args: {
    conventionId: v.id("conventions"),
    visibility: tournamentVisibilityValidator,
  },
  handler: async (ctx, args) => {
    await requireConventionOrganizerAccess(ctx, args.conventionId);
    await ctx.db.patch(args.conventionId, {
      visibility: args.visibility,
      updatedAt: Date.now(),
    });
    return args.conventionId;
  },
});

export const publishConvention = mutation({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    const { convention, user } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    requireConventionSetupEditable(convention);
    await ctx.db.patch(args.conventionId, {
      lifecycle: "registration",
      updatedAt: Date.now(),
    });
    await logConventionAuditEvent(ctx, {
      conventionId: args.conventionId,
      actor: user,
      actorRole: "organizer",
      event: { type: "convention_published" },
    });
    return args.conventionId;
  },
});

// The organizer explicitly completes the convention — a convention has no
// rounds to derive completion from, and no in_progress phase to pass
// through (ADR 0004): "registration" runs until exactly this. Completion is
// the payout trigger for paid conventions, exactly as completing a
// tournament is (model/progression.ts).
export const completeConvention = mutation({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    const { convention, user } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    if (convention.lifecycle !== "registration") {
      throw new Error("Convention cannot be completed in its current state");
    }
    await ctx.db.patch(args.conventionId, {
      lifecycle: "completed",
      updatedAt: Date.now(),
    });
    await logConventionAuditEvent(ctx, {
      conventionId: args.conventionId,
      actor: user,
      actorRole: "organizer",
      event: { type: "convention_completed" },
    });
    if (await conventionHasPaidTicketType(ctx, args.conventionId)) {
      // Sales ran until this very moment, so live checkouts may still be
      // open. Close them before the payout sweep runs: an unswept session
      // could charge after completion, and an orphaned open order would
      // block deletion forever (completed conventions cannot be cancelled
      // to sweep it).
      await ctx.scheduler.runAfter(
        0,
        internal.payments.refunds.closeOpenOrdersSweep,
        { conventionId: args.conventionId },
      );
      await ctx.scheduler.runAfter(
        0,
        internal.payments.payouts.startPayoutSweep,
        { conventionId: args.conventionId },
      );
    }
    return args.conventionId;
  },
});

// Cancels the convention. Child events are deliberately left attached and
// untouched — they are independent events that may still run; the client
// warns and lists still-active children before confirming. Badge money
// comes back through the same sweeps a cancelled tournament runs.
export const cancelConvention = mutation({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    const { convention, user } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    if (convention.lifecycle === "completed") {
      throw new Error("Completed conventions cannot be cancelled");
    }
    if (convention.lifecycle === "cancelled") {
      throw new Error("Convention is already cancelled");
    }
    await ctx.db.patch(args.conventionId, {
      lifecycle: "cancelled",
      updatedAt: Date.now(),
    });
    await logConventionAuditEvent(ctx, {
      conventionId: args.conventionId,
      actor: user,
      actorRole: "organizer",
      event: { type: "convention_cancelled" },
    });
    if (await conventionHasPaidTicketType(ctx, args.conventionId)) {
      await ctx.scheduler.runAfter(
        0,
        internal.payments.refunds.closeOpenOrdersSweep,
        { conventionId: args.conventionId },
      );
      await ctx.scheduler.runAfter(
        0,
        internal.payments.refunds.cancelEventPaymentsSweep,
        { conventionId: args.conventionId },
      );
    }
    return args.conventionId;
  },
});

// Permanently deletes a convention. Children are force-detached (never
// deleted — the events themselves are preserved, TODO.md §4); badges,
// payment history, and the audit trail drain in scheduled batches. Refused
// while any badge money is unsettled, like tournament deletion.
export const deleteConvention = mutation({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    const { convention } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    await requireEventPaymentsSettled(ctx, {
      kind: "convention",
      event: convention,
    });
    await ctx.db.patch(args.conventionId, {
      lifecycle: "cancelled",
      visibility: "private",
      updatedAt: Date.now(),
    });

    if (await deleteConventionOperationalDataBatch(ctx, args.conventionId)) {
      await ctx.db.delete(args.conventionId);
    } else {
      await ctx.scheduler.runAfter(
        0,
        internal.conventions.lifecycle.continueDeleteConvention,
        { conventionId: args.conventionId },
      );
    }
    return args.conventionId;
  },
});

export const continueDeleteConvention = internalMutation({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    if (!(await ctx.db.get(args.conventionId))) {
      return null;
    }
    if (!(await deleteConventionOperationalDataBatch(ctx, args.conventionId))) {
      await ctx.scheduler.runAfter(
        0,
        internal.conventions.lifecycle.continueDeleteConvention,
        args,
      );
      return null;
    }
    await ctx.db.delete(args.conventionId);
    return null;
  },
});
