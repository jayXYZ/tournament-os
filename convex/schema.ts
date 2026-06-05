import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  invitationStatusValidator,
  membershipStatusValidator,
  organizationStatusValidator,
  organizerRoleValidator,
} from "./validators";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    workosUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tokenIdentifier", ["tokenIdentifier"])
    .index("by_workosUserId", ["workosUserId"]),

  organizations: defineTable({
    workosOrganizationId: v.string(),
    name: v.string(),
    slug: v.string(),
    createdBy: v.id("users"),
    status: organizationStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workosOrganizationId", ["workosOrganizationId"])
    .index("by_slug", ["slug"]),

  organizationMemberships: defineTable({
    workosMembershipId: v.optional(v.string()),
    organizationId: v.id("organizations"),
    workosOrganizationId: v.string(),
    userId: v.optional(v.id("users")),
    tokenIdentifier: v.optional(v.string()),
    workosUserId: v.optional(v.string()),
    email: v.optional(v.string()),
    role: organizerRoleValidator,
    status: membershipStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_userId_and_status", [
      "organizationId",
      "userId",
      "status",
    ])
    .index("by_userId_and_status", ["userId", "status"])
    .index("by_workosUserId", ["workosUserId"])
    .index("by_workosMembershipId", ["workosMembershipId"])
    .index("by_workosOrganizationId_and_workosUserId", [
      "workosOrganizationId",
      "workosUserId",
    ])
    .index("by_workosOrganizationId_and_email", [
      "workosOrganizationId",
      "email",
    ]),

  organizationInvitations: defineTable({
    workosInvitationId: v.string(),
    organizationId: v.id("organizations"),
    workosOrganizationId: v.string(),
    email: v.string(),
    role: organizerRoleValidator,
    status: invitationStatusValidator,
    invitedBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_workosInvitationId", ["workosInvitationId"])
    .index("by_organizationId_and_email", ["organizationId", "email"]),

  workosEvents: defineTable({
    eventId: v.string(),
    eventName: v.string(),
    payload: v.any(),
    processedAt: v.number(),
  }).index("by_eventId", ["eventId"]),
});
