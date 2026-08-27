import { v } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  query,
} from "../_generated/server";
import { logAuditEvent } from "../model/auditLog";
import { orderTransferGroup } from "../model/payments";
import { requirePaymentsPermission } from "../model/stripeAccounts";
import { requireOrganizerAccess } from "../model/tournaments";
import { getStripeGateway } from "../stripe/client";
import { requireStripeSecretKey } from "../stripe/config";

// The tournament payout sweep, scheduled when a paid tournament completes:
// one transfer per paid order (source_transaction = the order's charge,
// amount = entry fee) minus a greedy deduction of the organizer-absorbed
// refund fees. Enumeration is a batched mutation continuation; the send
// action re-checks the live transfers capability before moving money and
// every transfer carries a per-row idempotency key, so retries never
// double-pay.

const ENUMERATION_BATCH = 64;
const SEND_BATCH = 16;
const MAX_TRANSFER_ATTEMPTS = 5;
const RETRY_DELAY_MS = 60_000;
// Refund rows are bounded by orders, which are bounded by registrations and
// the rate limiter; this bounds the absorbed-fee sum read.
const MAX_REFUND_ROWS = 4096;

export const startPayoutSweep = internalMutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (
      !tournament ||
      tournament.lifecycle !== "completed" ||
      (tournament.entryFeeCents ?? 0) <= 0
    ) {
      return null;
    }
    const existing = await ctx.db
      .query("tournamentPayouts")
      .withIndex("by_tournamentId", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .unique();
    if (existing) {
      return null;
    }

    const account = await ctx.db
      .query("organizationStripeAccounts")
      .withIndex("by_organizationId", (q) =>
        q.eq("organizationId", tournament.organizationId),
      )
      .unique();
    const now = Date.now();
    if (!account) {
      await ctx.db.insert("tournamentPayouts", {
        tournamentId: tournament._id,
        organizationId: tournament.organizationId,
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
    const pendingRefund = await ctx.db
      .query("paymentRefunds")
      .withIndex("by_tournamentId_and_status", (q) =>
        q.eq("tournamentId", args.tournamentId).eq("status", "pending"),
      )
      .first();
    if (pendingRefund) {
      await ctx.db.insert("tournamentPayouts", {
        tournamentId: tournament._id,
        organizationId: tournament.organizationId,
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

    const succeededRefunds = await ctx.db
      .query("paymentRefunds")
      .withIndex("by_tournamentId_and_status", (q) =>
        q.eq("tournamentId", args.tournamentId).eq("status", "succeeded"),
      )
      .take(MAX_REFUND_ROWS);
    const absorbedFeeCents = succeededRefunds.reduce(
      (sum, refund) => sum + refund.absorbedFeeCents,
      0,
    );

    const payoutId = await ctx.db.insert("tournamentPayouts", {
      tournamentId: tournament._id,
      organizationId: tournament.organizationId,
      stripeAccountId: account.stripeAccountId,
      status: "enumerating",
      totalEntryCents: 0,
      absorbedFeeCents,
      netCents: 0,
      remainingDeductionCents: absorbedFeeCents,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.payments.payouts.enumeratePayoutBatch,
      { payoutId },
    );
    return null;
  },
});

export const enumeratePayoutBatch = internalMutation({
  args: { payoutId: v.id("tournamentPayouts") },
  handler: async (ctx, args) => {
    const payout = await ctx.db.get(args.payoutId);
    if (!payout || payout.status !== "enumerating") {
      return null;
    }

    const {
      page: orders,
      isDone,
      continueCursor,
    } = await ctx.db
      .query("paymentOrders")
      .withIndex("by_tournamentId_and_status", (q) =>
        q.eq("tournamentId", payout.tournamentId).eq("status", "paid"),
      )
      .paginate({
        numItems: ENUMERATION_BATCH,
        cursor: payout.enumerationCursor ?? null,
      });

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
          tournamentId: payout.tournamentId,
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
        tournamentId: payout.tournamentId,
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
  args: { payoutId: v.id("tournamentPayouts") },
  handler: async (ctx, args) => {
    const payout = await ctx.db.get(args.payoutId);
    if (!payout || payout.status !== "sending") {
      return null;
    }
    return { stripeAccountId: payout.stripeAccountId };
  },
});

export const takeQueuedTransfers = internalMutation({
  args: { payoutId: v.id("tournamentPayouts") },
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
  args: { payoutId: v.id("tournamentPayouts") },
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
      await logAuditEvent(ctx, {
        tournamentId: payout.tournamentId,
        actorRole: "system",
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
      await logAuditEvent(ctx, {
        tournamentId: payout.tournamentId,
        actorRole: "system",
        event: { type: "payout_sent", netCents: payout.netCents },
      });
    }
    return null;
  },
});

export const markPayoutBlocked = internalMutation({
  args: { payoutId: v.id("tournamentPayouts"), error: v.string() },
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
  args: { payoutId: v.id("tournamentPayouts") },
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

// The organizer-facing payout summary for a completed paid tournament.
export const getTournamentPayout = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const { tournament } = await requireOrganizerAccess(ctx, args.tournamentId);
    const payout = await ctx.db
      .query("tournamentPayouts")
      .withIndex("by_tournamentId", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .unique();
    if (!payout) {
      return null;
    }
    return {
      status: payout.status,
      totalEntryCents: payout.totalEntryCents,
      absorbedFeeCents: payout.absorbedFeeCents,
      netCents: payout.netCents,
      error: payout.error ?? null,
      updatedAt: payout.updatedAt,
      isPaidTournament: (tournament.entryFeeCents ?? 0) > 0,
    };
  },
});

// Owner-triggered retry for a blocked or failed payout: an early block
// (no transfer rows yet) restarts the sweep from scratch, a send-stage
// block/failure re-queues the failed rows and resumes sending.
export const retryPayout = action({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args): Promise<null> => {
    await (ctx.runMutation(internal.payments.payouts.beginPayoutRetry, {
      tournamentId: args.tournamentId,
    }) satisfies Promise<null>);
    return null;
  },
});

export const beginPayoutRetry = internalMutation({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) {
      throw new Error("Tournament not found");
    }
    await requirePaymentsPermission(ctx, tournament.organizationId);

    const payout = await ctx.db
      .query("tournamentPayouts")
      .withIndex("by_tournamentId", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .unique();
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
        { tournamentId: args.tournamentId },
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
