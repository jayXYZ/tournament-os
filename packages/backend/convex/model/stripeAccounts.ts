import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { requireActiveMembership, requireActiveOrganization } from "./access";
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
export async function applyStripeAccountStatus(
  ctx: MutationCtx,
  account: Doc<"organizationStripeAccounts">,
  transfersCapabilityStatus: TransfersCapabilityStatus,
) {
  const now = Date.now();
  await ctx.db.patch(account._id, {
    transfersCapabilityStatus,
    payoutsReady: transfersCapabilityStatus === "active",
    lastSyncedAt: now,
    updatedAt: now,
  });
}

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
