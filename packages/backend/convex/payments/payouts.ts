import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  query,
  type MutationCtx,
} from "../_generated/server";
import { logEventPayoutAudit } from "../model/auditLog";
import { requireConventionOrganizerAccess } from "../model/conventions";
import type { MoneyRowOwner } from "../model/paidEventOwner";
import {
  moneyRowOwnerArgs,
  moneyRowOwnerColumns,
  parseMoneyRowOwner,
} from "../model/paidEventOwner";
import { orderTransferGroup } from "../model/payments";
import { requirePaymentsPermission } from "../model/stripeAccounts";
import { conventionHasPaidTicketType } from "../model/ticketTypes";
import { requireOrganizerAccess } from "../model/tournaments";
import { getStripeGateway } from "../stripe/client";
import { requireStripeSecretKey } from "../stripe/config";

// The event payout sweep, scheduled when a paid tournament or convention
// completes: one transfer per paid order (source_transaction = the order's
// charge, amount = entry fee) minus a greedy deduction of the
// organizer-absorbed refund fees. Enumeration is a batched mutation
// continuation; the send action re-checks the live transfers capability
// before moving money and every transfer carries a per-row idempotency key,
// so retries never double-pay.

const ENUMERATION_BATCH = 64;
const SEND_BATCH = 16;
const MAX_TRANSFER_ATTEMPTS = 5;
const RETRY_DELAY_MS = 60_000;
// Page size for the batched absorbed-fee summation over succeeded refunds.
// Batched (not a single .take) because a convention admits up to 10,000
// badges and every one can leave an absorbed-fee refund row; a capped read
// would silently under-deduct and overpay the organizer.
const SUMMING_BATCH = 256;

// The completed paid event a payout belongs to, or null when the sweep has
// nothing to do (not completed, free, or gone). "Paid" is the tournament's
// entryFeeCents or, for conventions, any paid ticket type (ADR 0004).
async function payoutSourceEvent(
  ctx: MutationCtx,
  owner: MoneyRowOwner,
): Promise<Doc<"tournaments"> | Doc<"conventions"> | null> {
  if (owner.kind === "convention") {
    const convention = await ctx.db.get(owner.conventionId);
    if (
      !convention ||
      convention.lifecycle !== "completed" ||
      !(await conventionHasPaidTicketType(ctx, convention._id))
    ) {
      return null;
    }
    return convention;
  }
  const tournament = await ctx.db.get(owner.tournamentId);
  if (
    !tournament ||
    tournament.lifecycle !== "completed" ||
    (tournament.entryFeeCents ?? 0) <= 0
  ) {
    return null;
  }
  return tournament;
}

async function payoutForOwner(ctx: MutationCtx, owner: MoneyRowOwner) {
  if (owner.kind === "convention") {
    return await ctx.db
      .query("eventPayouts")
      .withIndex("by_conventionId", (q) =>
        q.eq("conventionId", owner.conventionId),
      )
      .unique();
  }
  return await ctx.db
    .query("eventPayouts")
    .withIndex("by_tournamentId", (q) =>
      q.eq("tournamentId", owner.tournamentId),
    )
    .unique();
}

async function ownerRefundsWithStatus(
  ctx: MutationCtx,
  owner: MoneyRowOwner,
  status: Doc<"paymentRefunds">["status"],
  count: number,
) {
  if (owner.kind === "convention") {
    return await ctx.db
      .query("paymentRefunds")
      .withIndex("by_conventionId_and_status", (q) =>
        q.eq("conventionId", owner.conventionId).eq("status", status),
      )
      .take(count);
  }
  return await ctx.db
    .query("paymentRefunds")
    .withIndex("by_tournamentId_and_status", (q) =>
      q.eq("tournamentId", owner.tournamentId).eq("status", status),
    )
    .take(count);
}

export const startPayoutSweep = internalMutation({
  args: moneyRowOwnerArgs,
  handler: async (ctx, args) => {
    const owner = parseMoneyRowOwner(args);
    const event = await payoutSourceEvent(ctx, owner);
    if (!event) {
      return null;
    }
    const existing = await payoutForOwner(ctx, owner);
    if (existing) {
      return null;
    }

    const account = await ctx.db
      .query("organizationStripeAccounts")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", event.organizationId),
      )
      .unique();
    const now = Date.now();
    if (!account) {
      await ctx.db.insert("eventPayouts", {
        ...moneyRowOwnerColumns(owner),
        organizationId: event.organizationId,
        stripeAccountId: "",
        status: "blocked",
        totalEntryCents: 0,
        absorbedFeeCents: 0,
        netCents: 0,
        remainingDeductionCents: 0,
        error: "The organization has no connected Stripe account",
        updatedAt: now,
      });
      return null;
    }

    // The payout must not race an in-flight refund's amount out from under
    // it; a blocked payout is retried once refunds settle.
    const pendingRefund = await ownerRefundsWithStatus(
      ctx,
      owner,
      "pending",
      1,
    );
    if (pendingRefund.length > 0) {
      await ctx.db.insert("eventPayouts", {
        ...moneyRowOwnerColumns(owner),
        organizationId: event.organizationId,
        stripeAccountId: account.stripeAccountId,
        status: "blocked",
        totalEntryCents: 0,
        absorbedFeeCents: 0,
        netCents: 0,
        remainingDeductionCents: 0,
        error: "Refunds are still settling",
        updatedAt: now,
      });
      return null;
    }

    // The absorbed-fee deduction is summed in its own batched stage: the
    // refund count is bounded only by the badge/entry count, so a one-shot
    // capped read could truncate the sum and overpay the organizer.
    const payoutId = await ctx.db.insert("eventPayouts", {
      ...moneyRowOwnerColumns(owner),
      organizationId: event.organizationId,
      stripeAccountId: account.stripeAccountId,
      status: "summing",
      totalEntryCents: 0,
      absorbedFeeCents: 0,
      netCents: 0,
      remainingDeductionCents: 0,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.payments.payouts.sumAbsorbedFeesBatch,
      { payoutId },
    );
    return null;
  },
});

// Accumulates the organizer-absorbed refund fees one page at a time onto
// the payout row (the enumeration cursor is reused between stages; it is
// cleared when summing hands off). No refund can change the sum underneath
// the pagination: the sweep starts only after the pending-refund guard
// passes, and a completed event mints no new refunds.
export const sumAbsorbedFeesBatch = internalMutation({
  args: { payoutId: v.id("eventPayouts") },
  handler: async (ctx, args) => {
    const payout = await ctx.db.get(args.payoutId);
    if (!payout || payout.status !== "summing") {
      return null;
    }
    const owner = parseMoneyRowOwner(payout);
    const pagination = {
      numItems: SUMMING_BATCH,
      cursor: payout.enumerationCursor ?? null,
    };
    const {
      page: refunds,
      isDone,
      continueCursor,
    } = owner.kind === "convention"
      ? await ctx.db
          .query("paymentRefunds")
          .withIndex("by_conventionId_and_status", (q) =>
            q.eq("conventionId", owner.conventionId).eq("status", "succeeded"),
          )
          .paginate(pagination)
      : await ctx.db
          .query("paymentRefunds")
          .withIndex("by_tournamentId_and_status", (q) =>
            q.eq("tournamentId", owner.tournamentId).eq("status", "succeeded"),
          )
          .paginate(pagination);

    const absorbedFeeCents =
      payout.absorbedFeeCents +
      refunds.reduce((sum, refund) => sum + refund.absorbedFeeCents, 0);
    await ctx.db.patch(payout._id, {
      absorbedFeeCents,
      remainingDeductionCents: absorbedFeeCents,
      enumerationCursor: isDone ? undefined : continueCursor,
      status: isDone ? "enumerating" : "summing",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      isDone
        ? internal.payments.payouts.enumeratePayoutBatch
        : internal.payments.payouts.sumAbsorbedFeesBatch,
      { payoutId: payout._id },
    );
    return null;
  },
});

export const enumeratePayoutBatch = internalMutation({
  args: { payoutId: v.id("eventPayouts") },
  handler: async (ctx, args) => {
    const payout = await ctx.db.get(args.payoutId);
    if (!payout || payout.status !== "enumerating") {
      return null;
    }

    const owner = parseMoneyRowOwner(payout);
    const pagination = {
      numItems: ENUMERATION_BATCH,
      cursor: payout.enumerationCursor ?? null,
    };
    const {
      page: orders,
      isDone,
      continueCursor,
    } = owner.kind === "convention"
      ? await ctx.db
          .query("paymentOrders")
          .withIndex("by_conventionId_and_status", (q) =>
            q.eq("conventionId", owner.conventionId).eq("status", "paid"),
          )
          .paginate(pagination)
      : await ctx.db
          .query("paymentOrders")
          .withIndex("by_tournamentId_and_status", (q) =>
            q.eq("tournamentId", owner.tournamentId).eq("status", "paid"),
          )
          .paginate(pagination);

    let { remainingDeductionCents, totalEntryCents } = payout;
    const now = Date.now();
    for (const order of orders) {
      // Retry-safe: an order that already has its transfer row was handled
      // by a previous pass over this page. .unique() makes a duplicate row —
      // a broken one-transfer-per-order invariant — fail loudly instead of
      // silently double-paying.
      const alreadyRowed = await ctx.db
        .query("payoutTransfers")
        .withIndex("by_orderId", (q) => q.eq("orderId", order._id))
        .unique();
      if (alreadyRowed) {
        continue;
      }
      if (!order.stripeChargeId) {
        // Unreachable for a paid order (the webhook records the charge), but
        // a row without one cannot transfer; skip it visibly.
        await ctx.db.insert("payoutTransfers", {
          payoutId: payout._id,
          ...moneyRowOwnerColumns(owner),
          orderId: order._id,
          stripeChargeId: "",
          amountCents: 0,
          status: "skipped",
          attemptCount: 0,
          lastError: "Order has no charge id",
          updatedAt: now,
        });
        continue;
      }
      const entryCents = order.amountBreakdown.entryFeeCents;
      const deduction = Math.min(remainingDeductionCents, entryCents);
      const amountCents = entryCents - deduction;
      remainingDeductionCents -= deduction;
      totalEntryCents += entryCents;
      await ctx.db.insert("payoutTransfers", {
        payoutId: payout._id,
        ...moneyRowOwnerColumns(owner),
        orderId: order._id,
        stripeChargeId: order.stripeChargeId,
        amountCents,
        status: amountCents > 0 ? "queued" : "skipped",
        attemptCount: 0,
        updatedAt: now,
      });
    }

    await ctx.db.patch(payout._id, {
      remainingDeductionCents,
      totalEntryCents,
      netCents:
        totalEntryCents - (payout.absorbedFeeCents - remainingDeductionCents),
      enumerationCursor: continueCursor,
      status: isDone ? "sending" : "enumerating",
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      isDone
        ? internal.payments.payouts.sendTransfers
        : internal.payments.payouts.enumeratePayoutBatch,
      { payoutId: payout._id },
    );
    return null;
  },
});

export const beginSendTransfers = internalMutation({
  args: { payoutId: v.id("eventPayouts") },
  handler: async (ctx, args) => {
    const payout = await ctx.db.get(args.payoutId);
    if (!payout || payout.status !== "sending") {
      return null;
    }
    return { stripeAccountId: payout.stripeAccountId };
  },
});

export const takeQueuedTransfers = internalMutation({
  args: { payoutId: v.id("eventPayouts") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("payoutTransfers")
      .withIndex("by_payoutId_and_status", (q) =>
        q.eq("payoutId", args.payoutId).eq("status", "queued"),
      )
      .take(SEND_BATCH);
    return rows.map((row) => ({
      transferRowId: row._id,
      orderId: row.orderId,
      stripeChargeId: row.stripeChargeId,
      amountCents: row.amountCents,
    }));
  },
});

export const markTransferResult = internalMutation({
  args: {
    transferRowId: v.id("payoutTransfers"),
    outcome: v.union(v.literal("sent"), v.literal("failed")),
    stripeTransferId: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.transferRowId);
    if (!row || row.status !== "queued") {
      return null;
    }
    await ctx.db.patch(row._id, {
      status: args.outcome,
      stripeTransferId: args.stripeTransferId,
      attemptCount: row.attemptCount + (args.outcome === "failed" ? 1 : 0),
      lastError: args.errorMessage,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const finalizePayout = internalMutation({
  args: { payoutId: v.id("eventPayouts") },
  handler: async (ctx, args) => {
    const payout = await ctx.db.get(args.payoutId);
    if (!payout || payout.status !== "sending") {
      return null;
    }

    const failed = await ctx.db
      .query("payoutTransfers")
      .withIndex("by_payoutId_and_status", (q) =>
        q.eq("payoutId", args.payoutId).eq("status", "failed"),
      )
      .take(512);
    const retriable = failed.filter(
      (row) => row.attemptCount < MAX_TRANSFER_ATTEMPTS,
    );
    const now = Date.now();

    if (retriable.length > 0) {
      for (const row of retriable) {
        await ctx.db.patch(row._id, { status: "queued", updatedAt: now });
      }
      await ctx.scheduler.runAfter(
        RETRY_DELAY_MS,
        internal.payments.payouts.sendTransfers,
        { payoutId: args.payoutId },
      );
      return null;
    }

    if (failed.length > 0) {
      await ctx.db.patch(args.payoutId, {
        status: "failed",
        error: failed[0]!.lastError ?? "Transfer failed",
        updatedAt: now,
      });
      await logEventPayoutAudit(ctx, {
        owner: payout,
        event: { type: "payout_failed" },
      });
      return null;
    }

    await ctx.db.patch(args.payoutId, {
      status: "completed",
      error: undefined,
      updatedAt: now,
    });
    if (payout.netCents > 0) {
      await logEventPayoutAudit(ctx, {
        owner: payout,
        event: { type: "payout_sent", netCents: payout.netCents },
      });
    }
    return null;
  },
});

export const markPayoutBlocked = internalMutation({
  args: { payoutId: v.id("eventPayouts"), error: v.string() },
  handler: async (ctx, args) => {
    const payout = await ctx.db.get(args.payoutId);
    if (!payout || payout.status !== "sending") {
      return null;
    }
    await ctx.db.patch(args.payoutId, {
      status: "blocked",
      error: args.error,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const sendTransfers = internalAction({
  args: { payoutId: v.id("eventPayouts") },
  handler: async (ctx, args) => {
    const begin: { stripeAccountId: string } | null = await ctx.runMutation(
      internal.payments.payouts.beginSendTransfers,
      { payoutId: args.payoutId },
    );
    if (!begin) {
      return null;
    }

    const gateway = getStripeGateway(requireStripeSecretKey());
    // Money movement never trusts the snapshot: the live capability decides.
    const capability = await gateway.retrieveTransfersCapabilityStatus({
      stripeAccountId: begin.stripeAccountId,
    });
    if (capability !== "active") {
      await (ctx.runMutation(internal.payments.payouts.markPayoutBlocked, {
        payoutId: args.payoutId,
        error:
          "The organization's Stripe account is not ready to receive payouts",
      }) satisfies Promise<null>);
      return null;
    }

    for (;;) {
      const batch: Array<{
        transferRowId: Id<"payoutTransfers">;
        orderId: Id<"paymentOrders">;
        stripeChargeId: string;
        amountCents: number;
      }> = await ctx.runMutation(
        internal.payments.payouts.takeQueuedTransfers,
        { payoutId: args.payoutId },
      );
      if (batch.length === 0) {
        break;
      }
      for (const row of batch) {
        try {
          const { stripeTransferId } = await gateway.createTransfer({
            destinationAccountId: begin.stripeAccountId,
            amountCents: row.amountCents,
            sourceChargeId: row.stripeChargeId,
            transferGroup: orderTransferGroup(row.orderId),
            idempotencyKey: `transfer:${row.transferRowId}`,
          });
          await (ctx.runMutation(internal.payments.payouts.markTransferResult, {
            transferRowId: row.transferRowId,
            outcome: "sent",
            stripeTransferId,
          }) satisfies Promise<null>);
        } catch (error) {
          await (ctx.runMutation(internal.payments.payouts.markTransferResult, {
            transferRowId: row.transferRowId,
            outcome: "failed",
            errorMessage: error instanceof Error ? error.message : "Unknown",
          }) satisfies Promise<null>);
        }
      }
    }

    await (ctx.runMutation(internal.payments.payouts.finalizePayout, {
      payoutId: args.payoutId,
    }) satisfies Promise<null>);
    return null;
  },
});

// Shapes a payout row into the organizer-facing summary.
function payoutSummary(payout: Doc<"eventPayouts">, isPaidEvent: boolean) {
  return {
    status: payout.status,
    totalEntryCents: payout.totalEntryCents,
    absorbedFeeCents: payout.absorbedFeeCents,
    netCents: payout.netCents,
    error: payout.error ?? null,
    updatedAt: payout.updatedAt,
    isPaidTournament: isPaidEvent,
  };
}

// The organizer-facing payout summary for a completed paid tournament.
export const getTournamentPayout = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const payout = await ctx.db
      .query("eventPayouts")
      .withIndex("by_tournamentId", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .unique();
    return payout
      ? payoutSummary(payout, (tournament.entryFeeCents ?? 0) > 0)
      : null;
  },
});

// The convention twin: the badge-fee payout summary.
export const getConventionPayout = query({
  args: { conventionId: v.id("conventions") },
  handler: async (ctx, args) => {
    const { convention } = await requireConventionOrganizerAccess(
      ctx,
      args.conventionId,
    );
    const payout = await ctx.db
      .query("eventPayouts")
      .withIndex("by_conventionId", (q) =>
        q.eq("conventionId", args.conventionId),
      )
      .unique();
    return payout
      ? payoutSummary(
          payout,
          await conventionHasPaidTicketType(ctx, convention._id),
        )
      : null;
  },
});

// Owner-triggered retry for a blocked or failed payout: an early block
// (no transfer rows yet) restarts the sweep from scratch, a send-stage
// block/failure re-queues the failed rows and resumes sending. Takes
// exactly one of the owner pair.
export const retryPayout = action({
  args: moneyRowOwnerArgs,
  handler: async (ctx, args): Promise<null> => {
    await (ctx.runMutation(internal.payments.payouts.beginPayoutRetry, {
      tournamentId: args.tournamentId,
      conventionId: args.conventionId,
    }) satisfies Promise<null>);
    return null;
  },
});

export const beginPayoutRetry = internalMutation({
  args: moneyRowOwnerArgs,
  handler: async (ctx, args) => {
    const owner = parseMoneyRowOwner(args);
    const event =
      owner.kind === "convention"
        ? await ctx.db.get(owner.conventionId)
        : await ctx.db.get(owner.tournamentId);
    if (!event) {
      throw new Error("Event not found");
    }
    await requirePaymentsPermission(ctx, event.organizationId);

    const payout = await payoutForOwner(ctx, owner);
    if (
      !payout ||
      (payout.status !== "blocked" && payout.status !== "failed")
    ) {
      throw new Error("This payout is not awaiting a retry");
    }

    const anyRow = await ctx.db
      .query("payoutTransfers")
      .withIndex("by_payoutId_and_status", (q) => q.eq("payoutId", payout._id))
      .first();
    const now = Date.now();
    if (!anyRow) {
      // Blocked before enumeration (missing account, refunds settling):
      // restart the sweep with fresh preconditions.
      await ctx.db.delete(payout._id);
      await ctx.scheduler.runAfter(
        0,
        internal.payments.payouts.startPayoutSweep,
        moneyRowOwnerColumns(owner),
      );
      return null;
    }

    const failed = await ctx.db
      .query("payoutTransfers")
      .withIndex("by_payoutId_and_status", (q) =>
        q.eq("payoutId", payout._id).eq("status", "failed"),
      )
      .take(512);
    for (const row of failed) {
      await ctx.db.patch(row._id, {
        status: "queued",
        attemptCount: 0,
        updatedAt: now,
      });
    }
    await ctx.db.patch(payout._id, {
      status: "sending",
      error: undefined,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.payments.payouts.sendTransfers, {
      payoutId: payout._id,
    });
    return null;
  },
});
