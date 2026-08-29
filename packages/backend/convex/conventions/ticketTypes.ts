import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { mutation, query, type MutationCtx } from "../_generated/server";
import {
  canViewConvention,
  requireConvention,
  requireConventionEditable,
  requireConventionOrganizerAccess,
} from "../model/conventions";
import { requirePayoutsReadyOrganization } from "../model/payments";
import {
  MAX_TICKET_TYPES_PER_CONVENTION,
  effectiveSaleEnd,
  hasTicketTypeCapacity,
  isPaidTicketType,
  isTicketTypeOnSale,
  listTicketTypes,
  requireTicketTypeDeletable,
  requireTicketTypeForConvention,
  requireTicketTypePriceEditable,
  validIncludedTournamentIds,
  validTicketTypeInputs,
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
    const ticketTypes = await listTicketTypes(ctx, args.conventionId);
    return ticketTypes.map((ticketType) => ({
      ticketTypeId: ticketType._id,
      name: ticketType.name,
      description: ticketType.description ?? null,
      priceCents: ticketType.priceCents,
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
      ticketTypes.map(async (ticketType) => {
        const order = await ctx.db
          .query("paymentOrders")
          .withIndex("by_ticketTypeId", (q) =>
            q.eq("ticketTypeId", ticketType._id),
          )
          .first();
        return {
          ...ticketType,
          effectiveSaleEndDate: effectiveSaleEnd(ticketType, convention),
          onSale: isTicketTypeOnSale(convention, ticketType, now),
          priceLocked: order !== null,
        };
      }),
    );
  },
});

async function validatedInputs(
  ctx: MutationCtx,
  convention: Doc<"conventions">,
  args: {
    name: string;
    description?: string;
    priceCents: number;
    capacity?: number;
    admissionStartDate?: number;
    admissionEndDate?: number;
    saleStartDate?: number;
    saleEndDate?: number;
    includedTournamentIds?: Array<Doc<"tournaments">["_id"]>;
  },
) {
  const inputs = validTicketTypeInputs(convention, args);
  const includedTournamentIds = await validIncludedTournamentIds(
    ctx,
    convention,
    args.includedTournamentIds ?? [],
  );
  if (isPaidTicketType(inputs)) {
    if (convention.isTestEvent) {
      throw new Error("Test conventions cannot charge for tickets");
    }
    // Charging is only allowed once the organization can be paid out, same
    // rule as the tournament entry fee.
    await requirePayoutsReadyOrganization(ctx, convention.organizationId);
  }
  return { inputs, includedTournamentIds };
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
    const ticketType = await ctx.db.get(args.ticketTypeId);
    if (!ticketType) {
      throw new Error("Ticket type not found");
    }
    const { convention } = await requireConventionOrganizerAccess(
      ctx,
      ticketType.conventionId,
    );
    requireConventionEditable(convention);
    await requireTicketTypeForConvention(ctx, convention, args.ticketTypeId);
    const { inputs, includedTournamentIds } = await validatedInputs(
      ctx,
      convention,
      args,
    );
    if (inputs.priceCents !== ticketType.priceCents) {
      await requireTicketTypePriceEditable(ctx, ticketType._id);
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
    const ticketType = await ctx.db.get(args.ticketTypeId);
    if (!ticketType) {
      throw new Error("Ticket type not found");
    }
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
