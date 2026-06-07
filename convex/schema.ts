import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  invitationStatusValidator,
  membershipStatusValidator,
  organizationStatusValidator,
  organizerRoleValidator,
  tournamentStatusValidator,
  tournamentRegistrationStatusValidator,
  tournamentPhaseStatusValidator,
  tournamentRoundStatusValidator,
  tournamentMatchStatusValidator,
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

  tournaments: defineTable({
    name: v.string(),
    organizationId: v.id("organizations"),
    createdBy: v.id("users"),
    status: tournamentStatusValidator,
    startDate: v.number(),
    playerCapacity: v.number(),
    format: v.string(),
    isTestEvent: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_status_and_startDate", ["status", "startDate"])
    .index("by_organizationId_and_status_and_startDate", [
      "organizationId",
      "status",
      "startDate",
    ]),

  tournamentRegistrations: defineTable({
    tournamentId: v.id("tournaments"),
    userId: v.id("users"),
    status: tournamentRegistrationStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournamentId", ["tournamentId"])
    .index("by_tournamentId_and_userId", ["tournamentId", "userId"])
    .index("by_tournamentId_and_status", ["tournamentId", "status"])
    .index("by_userId_and_status", ["userId", "status"]),

  tournamentPhases: defineTable({
    tournamentId: v.id("tournaments"),
    phaseType: v.string(),
    phaseOrder: v.number(),
    phaseStatus: tournamentPhaseStatusValidator,
    phaseTotalRounds: v.number(),
    phaseCurrentRound: v.optional(v.id("tournamentRounds")),
    phaseCutoff: v.union(
      v.literal("top_X_players"),
      v.literal("X_points_or_more"),
      v.null(),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournamentId", ["tournamentId"])
    .index("by_tournamentId_and_phaseOrder", ["tournamentId", "phaseOrder"]),

  tournamentRounds: defineTable({
    tournamentId: v.id("tournaments"),
    tournamentPhaseId: v.id("tournamentPhases"),
    roundNumber: v.number(),
    roundName: v.string(),
    roundStatus: tournamentRoundStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournamentPhaseId", ["tournamentPhaseId"])
    .index("by_tournamentPhaseId_and_roundNumber", [
      "tournamentPhaseId",
      "roundNumber",
    ]),

  tournamentMatches: defineTable({
    tournamentId: v.id("tournaments"),
    tournamentPhaseId: v.id("tournamentPhases"),
    tournamentRoundId: v.id("tournamentRounds"),
    tableNumber: v.number(),
    matchStatus: tournamentMatchStatusValidator,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournamentRoundId", ["tournamentRoundId"])
    .index("by_tournamentRoundId_and_tableNumber", [
      "tournamentRoundId",
      "tableNumber",
    ]),

  tournamentMatchPlayers: defineTable({
    tournamentMatchId: v.id("tournamentMatches"),
    playerId: v.id("tournamentRegistrations"),
    opponentPlayerId: v.optional(v.id("tournamentRegistrations")),
    matchPointsEarned: v.optional(v.number()),
    gameWins: v.optional(v.number()),
    gameLosses: v.optional(v.number()),
    isBye: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournamentMatchId_and_playerId", [
      "tournamentMatchId",
      "playerId",
    ])
    .index("by_playerId", ["playerId"]),

  roundStandings: defineTable({
    tournamentId: v.id("tournaments"),
    tournamentPhaseId: v.id("tournamentPhases"),
    tournamentRoundId: v.id("tournamentRounds"),
    playerId: v.id("tournamentRegistrations"),
    rank: v.number(),
    matchPoints: v.number(),
    matchWins: v.number(),
    matchLosses: v.number(),
    matchDraws: v.number(),
    opponentMatchWinPct: v.number(),
    gameWinPct: v.number(),
    opponentGameWinPct: v.number(),
    sortKey: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournamentRoundId_and_playerId", [
      "tournamentRoundId",
      "playerId",
    ])
    .index("by_tournamentRoundId_and_rank", ["tournamentRoundId", "rank"]),

  tournamentTestConfigs: defineTable({
    tournamentId: v.id("tournaments"),
    dummyPlayerCount: v.number(),
    roundsToGenerate: v.number(),
    seed: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_tournamentId", ["tournamentId"]),

  testTournamentPlayers: defineTable({
    tournamentId: v.id("tournaments"),
    userId: v.id("users"),
    playerNumber: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournamentId", ["tournamentId"])
    .index("by_tournamentId_and_playerNumber", [
      "tournamentId",
      "playerNumber",
    ])
    .index("by_userId", ["userId"]),
});
