import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireActiveMembership, requireActiveOrganization } from "./access";
import type { MoneyRowOwner } from "./paidEventOwner";
import type { TransfersCapabilityStatus } from "../stripe/client";
import { canManageOrganizationPayments } from "../validators";

export async function stripeAccountForOrganization(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
) {
  return await ctx.db
    .query("organizationStripeAccounts")
    .withIndex("by_organizationId", (q) =>
      q.eq("organizationId", organizationId),
    )
    .unique();
}

export async function stripeAccountByStripeAccountId(
  ctx: QueryCtx,
  stripeAccountId: string,
) {
  return await ctx.db
    .query("organizationStripeAccounts")
    .withIndex("by_stripeAccountId", (q) =>
      q.eq("stripeAccountId", stripeAccountId),
    )
    .unique();
}

// The one writer of the capability snapshot, shared by the manual refresh and
// the account event destination. `payoutsReady` is derived from the
// transfers capability here so every status writer keeps the invariant.
//
// Freshness guard: every writer reads Stripe in an action and commits in a
// separate mutation, so two overlapping syncs (a thin-event delivery racing
// the refresh button, or two deliveries) can commit in reverse order of
// their reads. Each caller stamps `observedAt` — the time its Stripe read
// began — and `lastSyncedAt` stores that stamp, so a read that began before
// the stored snapshot's read is stale and leaves the newer status in place.
// A dropped stale read loses nothing: the stored snapshot is already newer.
export async function applyStripeAccountStatus(
  ctx: MutationCtx,
  account: Doc<"organizationStripeAccounts">,
  args: {
    transfersCapabilityStatus: TransfersCapabilityStatus;
    observedAt: number;
  },
): Promise<StripeAccountStatusSnapshot> {
  if (
    account.lastSyncedAt !== undefined &&
    args.observedAt <= account.lastSyncedAt
  ) {
    return {
      applied: false,
      transfersCapabilityStatus: account.transfersCapabilityStatus,
      payoutsReady: account.payoutsReady,
    };
  }
  const payoutsReady = args.transfersCapabilityStatus === "active";
  await ctx.db.patch(account._id, {
    transfersCapabilityStatus: args.transfersCapabilityStatus,
    payoutsReady,
    lastSyncedAt: args.observedAt,
    updatedAt: Date.now(),
  });
  return {
    applied: true,
    transfersCapabilityStatus: args.transfersCapabilityStatus,
    payoutsReady,
  };
}

// What the snapshot holds after a write attempt: the stored status, which is
// the caller's read when applied and the newer stored one when stale.
export type StripeAccountStatusSnapshot = {
  applied: boolean;
  transfersCapabilityStatus: TransfersCapabilityStatus;
  payoutsReady: boolean;
};

// Managing the Stripe connection controls where event money lands, so it is
// owner-only (canManageOrganizationPayments) rather than reusing the
// owner-or-admin profile permission.
export async function requirePaymentsPermission(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
) {
  const { user, membership } = await requireActiveMembership(
    ctx,
    organizationId,
  );
  if (!canManageOrganizationPayments(membership.role)) {
    throw new Error("Unauthorized");
  }

  const organization = await requireActiveOrganization(ctx, organizationId);
  return { organization, membership, user };
}

// The payments gate for an operator action on a money row (a payout retry,
// a refund re-drive): resolves the owning event and requires the payments
// permission on its organization. The one place that resolution lives, so
// a change to how a money row's owner authorizes payments actions lands in
// every gated verb at once.
export async function requireOwnerPaymentsPermission(
  ctx: QueryCtx,
  owner: MoneyRowOwner,
) {
  const event =
    owner.kind === "convention"
      ? await ctx.db.get(owner.conventionId)
      : await ctx.db.get(owner.tournamentId);
  if (!event) {
    throw new Error("Event not found");
  }
  return await requirePaymentsPermission(ctx, event.organizationId);
}
