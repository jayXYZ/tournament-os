import { v } from "convex/values";

import { computeOrderBreakdown } from "@tournament-os/shared/payment-fees";

import type { Doc } from "../_generated/dataModel";
import { mutation, query, type MutationCtx } from "../_generated/server";
import {
  canViewConvention,
  requireConvention,
  requireConventionEditable,
  requireConventionOrganizerAccess,
} from "../model/conventions";
import { requirePayoutsReadyOrganization } from "../model/payments";
import { feeConfigFromEnv } from "../stripe/config";
import {
  MAX_TICKET_TYPES_PER_CONVENTION,
  effectiveSaleEnd,
  hasTicketTypeCapacity,
  isPaidTicketType,
  isTicketTypeOnSale,
  listTicketTypes,
  requireTicketType,
  requireTicketTypeDeletable,
  requireTicketTypePriceEditable,
  ticketTypeHasOrders,
  validIncludedTournamentIds,
  validTicketTypeInputs,
  type TicketTypeInputs,
} from "../model/ticketTypes";

// The ticket-type surface (ADR 0004): the organizer's CRUD over a
// convention's passes, and the public listing the convention page sells
// from. The rules live in model/ticketTypes.ts.

const ticketTypeInputArgs = {
  name: v.string(),
  description: v.optional(v.string()),
  priceCents: v.number(),
  capacity: v.optional(v.number()),
  admissionStartDate: v.optional(v.number()),
  admissionEndDate: v.optional(v.number()),
  saleStartDate: v.optional(v.number()),
  saleEndDate: v.optional(v.number()),
  includedTournamentIds: v.optional(v.array(v.id("tournaments"))),
};

// The public sale listing: every type with derived availability, so the
// page can render sold-out and sale-window states honestly without
// re-implementing the rules. Follows the convention page's own access rule
// (canViewConvention) — a hidden convention exposes no types or prices.
export const listPublicTicketTypes = query({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    const convention = await requireConvention(ctx, args.conventionId);
    if (!(await canViewConvention(ctx, convention))) {
      return [];
    }
    const now = Date.now();
    const feeConfig = feeConfigFromEnv();
    const ticketTypes = await listTicketTypes(ctx, args.conventionId);
    return ticketTypes.map((ticketType) => ({
      ticketTypeId: ticketType._id,
      name: ticketType.name,
      description: ticketType.description ?? null,
      priceCents: ticketType.priceCents,
      // What the buyer pays with fees, from the same shared math the order
      // writer snapshots — one listing subscription instead of a fee-preview
      // query per row.
      totalWithFeesCents: isPaidTicketType(ticketType)
        ? computeOrderBreakdown(ticketType.priceCents, feeConfig).totalCents
        : null,
      sortOrder: ticketType.sortOrder,
      admissionStartDate: ticketType.admissionStartDate ?? null,
      admissionEndDate: ticketType.admissionEndDate ?? null,
      saleStartDate: ticketType.saleStartDate ?? null,
      saleEndDate: effectiveSaleEnd(ticketType, convention),
      includedTournamentIds: ticketType.includedTournamentIds,
      onSale: isTicketTypeOnSale(convention, ticketType, now),
      soldOut: !hasTicketTypeCapacity(ticketType),
    }));
  },
});

// The organizer's full list, with the per-type lock the settings UI needs
// (a priced type with any order keeps its price).
export const listTicketTypesForOrganizer = query({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    const { convention } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    const now = Date.now();
    const ticketTypes = await listTicketTypes(ctx, args.conventionId);
    return await Promise.all(
      ticketTypes.map(async (ticketType) => ({
        ...ticketType,
        effectiveSaleEndDate: effectiveSaleEnd(ticketType, convention),
        onSale: isTicketTypeOnSale(convention, ticketType, now),
        priceLocked: await ticketTypeHasOrders(ctx, ticketType._id),
      })),
    );
  },
});

async function validatedInputs(
  ctx: MutationCtx,
  convention: Doc<"conventions">,
  args: TicketTypeInputs & {
    includedTournamentIds?: Array<Doc<"tournaments">["_id"]>;
  },
) {
  const inputs = validTicketTypeInputs(convention, args);
  const includedTournamentIds = await validIncludedTournamentIds(
    ctx,
    convention,
    args.includedTournamentIds ?? [],
  );
  return { inputs, includedTournamentIds };
}

// The gate on a price BECOMING paid — create, or an update actually changing
// the price: real conventions only, and only once the organization can be
// paid out (the same rule as the tournament entry fee). Deliberately not
// re-checked on edits that keep a paid price as-is: if Stripe readiness
// regresses after a type sells, the organizer must still be able to edit
// capacity and sale windows — stopping the sale included.
async function requireCanChargeForTickets(
  ctx: MutationCtx,
  convention: Doc<"conventions">,
) {
  if (convention.isTestEvent) {
    throw new Error("Test conventions cannot charge for tickets");
  }
  await requirePayoutsReadyOrganization(ctx, convention.organizationId);
}

export const createTicketType = mutation({
  args: {
    conventionId: v.id("conventions"),
    ...ticketTypeInputArgs,
  },
  handler: async (ctx, args) => {
    const { convention } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    requireConventionEditable(convention);
    // New types are only mintable before the convention starts (ADR 0004);
    // editing existing ones — sale windows included — stays open for the
    // whole live run.
    if (Date.now() >= convention.startDate) {
      throw new Error(
        "New ticket types cannot be added once the convention has started",
      );
    }
    const existing = await listTicketTypes(ctx, args.conventionId);
    if (existing.length >= MAX_TICKET_TYPES_PER_CONVENTION) {
      throw new Error(
        `A convention can offer at most ${MAX_TICKET_TYPES_PER_CONVENTION} ticket types`,
      );
    }
    const { inputs, includedTournamentIds } = await validatedInputs(
      ctx,
      convention,
      args,
    );
    if (isPaidTicketType(inputs)) {
      await requireCanChargeForTickets(ctx, convention);
    }
    const now = Date.now();
    return await ctx.db.insert("conventionTicketTypes", {
      conventionId: args.conventionId,
      name: inputs.name,
      description: inputs.description,
      priceCents: inputs.priceCents,
      sortOrder:
        existing.length === 0
          ? 0
          : existing[existing.length - 1]!.sortOrder + 1,
      capacity: inputs.capacity,
      confirmedCount: 0,
      admissionStartDate: inputs.admissionStartDate,
      admissionEndDate: inputs.admissionEndDate,
      saleStartDate: inputs.saleStartDate,
      saleEndDate: inputs.saleEndDate,
      includedTournamentIds,
      updatedAt: now,
    });
  },
});

// Full-field update; the one frozen field is a sold type's price (the
// stored breakdowns snapshotted it). Windows, capacity, name, and comps
// stay live-editable — they are policy the reads consult, not snapshots.
export const updateTicketType = mutation({
  args: {
    ticketTypeId: v.id("conventionTicketTypes"),
    ...ticketTypeInputArgs,
  },
  handler: async (ctx, args) => {
    const ticketType = await requireTicketType(ctx, args.ticketTypeId);
    const { convention } = await requireConventionOrganizerAccess(
      ctx,
      ticketType.conventionId,
    );
    requireConventionEditable(convention);
    const { inputs, includedTournamentIds } = await validatedInputs(
      ctx,
      convention,
      args,
    );
    if (inputs.priceCents !== ticketType.priceCents) {
      await requireTicketTypePriceEditable(ctx, ticketType._id);
      if (isPaidTicketType(inputs)) {
        await requireCanChargeForTickets(ctx, convention);
      }
    }
    if (
      inputs.capacity !== undefined &&
      inputs.capacity < ticketType.confirmedCount
    ) {
      throw new Error(
        "Ticket capacity cannot be lower than its confirmed badge count",
      );
    }
    await ctx.db.patch(ticketType._id, {
      name: inputs.name,
      description: inputs.description,
      priceCents: inputs.priceCents,
      capacity: inputs.capacity,
      admissionStartDate: inputs.admissionStartDate,
      admissionEndDate: inputs.admissionEndDate,
      saleStartDate: inputs.saleStartDate,
      saleEndDate: inputs.saleEndDate,
      includedTournamentIds,
      updatedAt: Date.now(),
    });
    return ticketType._id;
  },
});

export const deleteTicketType = mutation({
  args: { ticketTypeId: v.id("conventionTicketTypes") },
  handler: async (ctx, args) => {
    const ticketType = await requireTicketType(ctx, args.ticketTypeId);
    const { convention } = await requireConventionOrganizerAccess(
      ctx,
      ticketType.conventionId,
    );
    requireConventionEditable(convention);
    await requireTicketTypeDeletable(ctx, args.ticketTypeId);
    await ctx.db.delete(args.ticketTypeId);
    return args.ticketTypeId;
  },
});
