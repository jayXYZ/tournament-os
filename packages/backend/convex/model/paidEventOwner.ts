import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

// The money tables (paymentOrders, paymentRefunds, eventPayouts,
// payoutTransfers) store their owner as an optional tournamentId/conventionId
// column pair so each side keeps its own database index. The raw pair makes
// both-set, neither-set, and a registrationId from the wrong table
// representable, so no module reads the columns directly: rows are stamped
// through moneyRowOwnerColumns and read back through the parsers here — the
// one seam that turns the pair into a discriminated owner and rejects the
// impossible shapes loudly instead of routing around them.

export type MoneyRowOwner =
  | { kind: "tournament"; tournamentId: Id<"tournaments"> }
  | { kind: "convention"; conventionId: Id<"conventions"> };

// The owner plus the matching-table registration id. The narrowing cast
// below is the single place the registrationId union collapses — safe
// because the insertion points (createEntryOrder, queueRefund) write the
// owner pair and registrationId together from one PaidEventRef.
export type MoneyRowEntry =
  | {
      kind: "tournament";
      tournamentId: Id<"tournaments">;
      registrationId: Id<"tournamentRegistrations">;
    }
  | {
      kind: "convention";
      conventionId: Id<"conventions">;
      registrationId: Id<"conventionRegistrations">;
    };

type OwnerColumns = {
  tournamentId?: Id<"tournaments">;
  conventionId?: Id<"conventions">;
};

// The owner half of every sweep/payout function's arguments, matching the
// money tables' owner columns. Handlers parse it immediately.
export const moneyRowOwnerArgs = {
  tournamentId: v.optional(v.id("tournaments")),
  conventionId: v.optional(v.id("conventions")),
};

export function parseMoneyRowOwner(row: OwnerColumns): MoneyRowOwner {
  if (row.tournamentId !== undefined && row.conventionId !== undefined) {
    throw new Error(
      "Money row owner has both a tournamentId and a conventionId",
    );
  }
  if (row.conventionId !== undefined) {
    return { kind: "convention", conventionId: row.conventionId };
  }
  if (row.tournamentId !== undefined) {
    return { kind: "tournament", tournamentId: row.tournamentId };
  }
  throw new Error(
    "Money row owner has neither a tournamentId nor a conventionId",
  );
}

export function parseMoneyRowEntry(
  row: OwnerColumns & {
    registrationId:
      | Id<"tournamentRegistrations">
      | Id<"conventionRegistrations">;
  },
): MoneyRowEntry {
  const owner = parseMoneyRowOwner(row);
  return owner.kind === "convention"
    ? {
        ...owner,
        registrationId: row.registrationId as Id<"conventionRegistrations">,
      }
    : {
        ...owner,
        registrationId: row.registrationId as Id<"tournamentRegistrations">,
      };
}

// The column pair to stamp onto a money row. Both keys are always present so
// an insert can never accidentally omit the unset side.
export function moneyRowOwnerColumns(owner: MoneyRowOwner): {
  tournamentId: Id<"tournaments"> | undefined;
  conventionId: Id<"conventions"> | undefined;
} {
  return owner.kind === "tournament"
    ? { tournamentId: owner.tournamentId, conventionId: undefined }
    : { tournamentId: undefined, conventionId: owner.conventionId };
}

// The owner-indexed reads over the money tables. Each table keeps a per-side
// index (by_tournamentId..., by_conventionId...); these adapters pick the
// owner's side once and hand back the ranged query, so callers chain
// .first()/.take()/.paginate() without re-branching on the kind at every
// read site.

export function ownerOrdersQuery(
  ctx: QueryCtx,
  owner: MoneyRowOwner,
  status?: Doc<"paymentOrders">["status"],
) {
  return owner.kind === "tournament"
    ? ctx.db
        .query("paymentOrders")
        .withIndex("by_tournamentId_and_status", (q) => {
          const byOwner = q.eq("tournamentId", owner.tournamentId);
          return status === undefined ? byOwner : byOwner.eq("status", status);
        })
    : ctx.db
        .query("paymentOrders")
        .withIndex("by_conventionId_and_status", (q) => {
          const byOwner = q.eq("conventionId", owner.conventionId);
          return status === undefined ? byOwner : byOwner.eq("status", status);
        });
}

export function ownerRefundsQuery(
  ctx: QueryCtx,
  owner: MoneyRowOwner,
  status?: Doc<"paymentRefunds">["status"],
) {
  return owner.kind === "tournament"
    ? ctx.db
        .query("paymentRefunds")
        .withIndex("by_tournamentId_and_status", (q) => {
          const byOwner = q.eq("tournamentId", owner.tournamentId);
          return status === undefined ? byOwner : byOwner.eq("status", status);
        })
    : ctx.db
        .query("paymentRefunds")
        .withIndex("by_conventionId_and_status", (q) => {
          const byOwner = q.eq("conventionId", owner.conventionId);
          return status === undefined ? byOwner : byOwner.eq("status", status);
        });
}

export function ownerRefundsForParticipantQuery(
  ctx: QueryCtx,
  owner: MoneyRowOwner,
  participantId: Id<"participants">,
) {
  return owner.kind === "tournament"
    ? ctx.db
        .query("paymentRefunds")
        .withIndex("by_tournamentId_and_participantId", (q) =>
          q
            .eq("tournamentId", owner.tournamentId)
            .eq("participantId", participantId),
        )
    : ctx.db
        .query("paymentRefunds")
        .withIndex("by_conventionId_and_participantId", (q) =>
          q
            .eq("conventionId", owner.conventionId)
            .eq("participantId", participantId),
        );
}

export function ownerPayoutsQuery(ctx: QueryCtx, owner: MoneyRowOwner) {
  return owner.kind === "tournament"
    ? ctx.db
        .query("eventPayouts")
        .withIndex("by_tournamentId", (q) =>
          q.eq("tournamentId", owner.tournamentId),
        )
    : ctx.db
        .query("eventPayouts")
        .withIndex("by_conventionId", (q) =>
          q.eq("conventionId", owner.conventionId),
        );
}
