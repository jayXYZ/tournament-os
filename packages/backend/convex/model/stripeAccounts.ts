import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { requireActiveMembership, requireActiveOrganization } from "./access";
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
