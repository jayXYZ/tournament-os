import { v } from "convex/values";

import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import {
  toInvitationStatus,
  toOrganizerRoleFromWorkosFields,
  type OrganizerRole,
} from "../lib/organizer-utils";
import {
  normalizeEmail,
  normalizeMembershipStatus,
} from "./validators";

export const process = internalMutation({
  args: {
    eventId: v.string(),
    eventName: v.string(),
    payload: v.any(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workosEvents")
      .withIndex("by_eventId", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existing) {
      return { duplicate: true };
    }

    const now = Date.now();
    await ctx.db.insert("workosEvents", {
      eventId: args.eventId,
      eventName: args.eventName,
      payload: args.payload,
      processedAt: now,
    });

    if (args.eventName.startsWith("organization_membership.")) {
      await processMembershipEvent(ctx, args.payload, now);
    }

    if (args.eventName.startsWith("invitation.")) {
      await processInvitationEvent(ctx, args.payload, now);
    }

    return { duplicate: false };
  },
});

async function processMembershipEvent(
  ctx: MutationCtx,
  payload: unknown,
  now: number,
) {
  const data = eventData(payload);
  const workosOrganizationId = stringField(data, "organization_id", "organizationId");
  const workosMembershipId = stringField(data, "id");
  if (!workosOrganizationId || !workosMembershipId) {
    return;
  }

  const organization = await ctx.db
    .query("organizations")
    .withIndex("by_workosOrganizationId", (q) =>
      q.eq("workosOrganizationId", workosOrganizationId),
    )
    .unique();
  if (!organization) {
    return;
  }

  const status = normalizeMembershipStatus(stringField(data, "status") ?? "pending");
  const role = roleField(data);
  const workosUserId = stringField(data, "user_id", "userId");
  const email = stringField(data, "email");
  const user = workosUserId
    ? await ctx.db
        .query("users")
        .withIndex("by_workosUserId", (q) => q.eq("workosUserId", workosUserId))
        .unique()
    : null;

  const existing = await ctx.db
    .query("organizationMemberships")
    .withIndex("by_workosMembershipId", (q) =>
      q.eq("workosMembershipId", workosMembershipId),
    )
    .unique();

  const patch = {
    organizationId: organization._id,
    workosOrganizationId,
    workosMembershipId,
    userId: user?._id,
    tokenIdentifier: user?.tokenIdentifier,
    workosUserId,
    email,
    role,
    status,
    updatedAt: now,
  };

  if (existing) {
    await ctx.db.patch(existing._id, patch);
    return;
  }

  await ctx.db.insert("organizationMemberships", patch);
}

async function processInvitationEvent(
  ctx: MutationCtx,
  payload: unknown,
  now: number,
) {
  const data = eventData(payload);
  const workosInvitationId = stringField(data, "id");
  const workosOrganizationId = stringField(data, "organization_id", "organizationId");
  const email = stringField(data, "email");
  if (!workosInvitationId || !workosOrganizationId || !email) {
    return;
  }

  const organization = await ctx.db
    .query("organizations")
    .withIndex("by_workosOrganizationId", (q) =>
      q.eq("workosOrganizationId", workosOrganizationId),
    )
    .unique();
  if (!organization) {
    return;
  }

  const existing = await ctx.db
    .query("organizationInvitations")
    .withIndex("by_workosInvitationId", (q) =>
      q.eq("workosInvitationId", workosInvitationId),
    )
    .unique();
  if (!existing) {
    return;
  }

  await ctx.db.patch(existing._id, {
    status: invitationStatus(stringField(data, "status", "state")),
    email: normalizeEmail(email),
    updatedAt: now,
  });
}

function eventData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return {};
  }

  const record = payload as Record<string, unknown>;
  const data = record.data;
  if (data && typeof data === "object") {
    return data as Record<string, unknown>;
  }

  return record;
}

function stringField(
  data: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function roleField(data: Record<string, unknown>): OrganizerRole {
  return toOrganizerRoleFromWorkosFields({
    role: data.role,
    role_slug: stringField(data, "role_slug"),
    roleSlug: stringField(data, "roleSlug"),
  });
}

function invitationStatus(status?: string) {
  return toInvitationStatus(status);
}
