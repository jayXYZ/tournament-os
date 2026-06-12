import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";

export async function requireIdentity(ctx: QueryCtx | MutationCtx | ActionCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }

  return identity;
}

export function identityWorkosUserId(identity: { subject: string }) {
  return identity.subject;
}
