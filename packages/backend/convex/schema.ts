import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  invitationStatusValidator,
  membershipStatusValidator,
  organizationStatusValidator,
  organizerRoleValidator,
  tournamentFormatValidator,
  tournamentStatusValidator,
  tournamentRegistrationStatusValidator,
  tournamentPhaseStatusValidator,
  tournamentPhaseRoundModeValidator,
  tournamentPhaseCutoffValidator,
  tournamentRoundStatusValidator,
  tournamentMatchStatusValidator,
} from "./validators";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    profileImageStorageId: v.optional(v.id("_storage")),
    createdBy: v.id("users"),
    status: organizationStatusValidator,
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  organizationMemberships: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    email: v.optional(v.string()),
    role: organizerRoleValidator,
    status: membershipStatusValidator,
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_organizationId_and_userId", ["organizationId", "userId"])
    .index("by_organizationId_and_userId_and_status", [
      "organizationId",
      "userId",
      "status",
    ])
    .index("by_userId_and_status", ["userId", "status"]),

  organizationInvitations: defineTable({
    organizationId: v.id("organizations"),
    email: v.string(),
    role: organizerRoleValidator,
    status: invitationStatusValidator,
    invitedBy: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_email_and_status", ["email", "status"])
    .index("by_organizationId_and_email", ["organizationId", "email"]),

  tournaments: defineTable({
    name: v.string(),
    publicCode: v.number(),
    organizationId: v.id("organizations"),
    createdBy: v.id("users"),
    status: tournamentStatusValidator,
    startDate: v.number(),
    playerCapacity: v.number(),
    format: tournamentFormatValidator,
    isTestEvent: v.boolean(),
    // Deterministic seed for pairing's within-bracket shuffle, so pairings are
    // reproducible and auditable. Optional for rows created before it existed;
    // readers fall back to publicCode.
    seed: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_organizationId", ["organizationId"])
    .index("by_publicCode", ["publicCode"])
    .index("by_status_and_startDate", ["status", "startDate"])
    .index("by_organizationId_and_status_and_startDate", [
      "organizationId",
      "status",
      "startDate",
    ]),

  appCounters: defineTable({
    key: v.string(),
    nextValue: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  tournamentRegistrations: defineTable({
    tournamentId: v.id("tournaments"),
    userId: v.id("users"),
    status: tournamentRegistrationStatusValidator,
    // Kept alongside _creationTime: pairing and standings tie-break on this,
    // and test seeding deliberately offsets it per player for determinism.
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournamentId", ["tournamentId"])
    .index("by_tournamentId_and_userId", ["tournamentId", "userId"])
    .index("by_tournamentId_and_status", ["tournamentId", "status"])
    .index("by_userId_and_status", ["userId", "status"]),

  tournamentPhases: defineTable({
    tournamentId: v.id("tournaments"),
    phaseName: v.optional(v.string()),
    phaseType: v.string(),
    phaseOrder: v.number(),
    phaseStatus: tournamentPhaseStatusValidator,
    phaseRoundMode: tournamentPhaseRoundModeValidator,
    phaseTotalRounds: v.union(v.number(), v.null()),
    phaseCurrentRound: v.optional(v.id("tournamentRounds")),
    phaseCutoff: tournamentPhaseCutoffValidator,
    // When set, the final round power-pairs (orders brackets by tiebreakers)
    // instead of random-within-bracket. Optional; readers default to true.
    powerPairFinalRound: v.optional(v.boolean()),
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
    // Byes have no table assignment; in the round index they sort before
    // numbered matches because undefined orders first.
    tableNumber: v.optional(v.number()),
    matchStatus: tournamentMatchStatusValidator,
    // Set when a player self-reports the result; absent once an organizer
    // records or overrides it. "completed" + this field = unconfirmed report.
    reportedByRegistrationId: v.optional(v.id("tournamentRegistrations")),
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
    // Cumulative totals through this round, denormalized so the next round's
    // standings and pairings never re-read full match history. Optional only
    // for rows written before these fields existed; readers fall back to a
    // per-player history walk when they are missing.
    gameWins: v.optional(v.number()),
    gameLosses: v.optional(v.number()),
    opponentIds: v.optional(v.array(v.id("tournamentRegistrations"))),
    hasHadBye: v.optional(v.boolean()),
    opponentMatchWinPct: v.number(),
    gameWinPct: v.number(),
    opponentGameWinPct: v.number(),
    sortKey: v.number(),
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
    updatedAt: v.number(),
  }).index("by_tournamentId", ["tournamentId"]),

  testTournamentPlayers: defineTable({
    tournamentId: v.id("tournaments"),
    userId: v.id("users"),
    playerNumber: v.number(),
    updatedAt: v.number(),
  })
    .index("by_tournamentId", ["tournamentId"])
    .index("by_tournamentId_and_playerNumber", ["tournamentId", "playerNumber"])
    .index("by_userId", ["userId"]),
});
