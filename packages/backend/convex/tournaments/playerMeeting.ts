import { v } from "convex/values";

import { mutation, query } from "../_generated/server";
import { logAuditEvent } from "../model/auditLog";
import {
  SWISS_FORMAT,
  activeRegistrations,
  comparePlayersAlphabetically,
  meetingSeats,
  registrationDisplayName,
  requireOrganizerAccess,
  requirePhase,
  swissPhaseByOrder,
} from "../model/tournaments";

// Seats every active player for a phase's player meeting: alphabetical order,
// two per table (players 1&2 at table 1, 3&4 at table 2, an odd player alone
// at the last table). The snapshot is taken exactly once — attendance drops
// happen through the normal dropRegistration flow and readers live-join
// registration status, so seat rows are never rewritten.
export const startPlayerMeeting = mutation({
  args: { phaseId: v.id("tournamentPhases") },
  handler: async (ctx, args) => {
    const phase = await requirePhase(ctx, args.phaseId);
    const { tournament, user } = await requireOrganizerAccess(
      ctx,
      phase.tournamentId,
    );
    if (
      tournament.lifecycle === "completed" ||
      tournament.lifecycle === "cancelled"
    ) {
      throw new Error("Tournament is no longer running");
    }
    if (phase.phaseType !== SWISS_FORMAT) {
      throw new Error("Phase is not a Swiss phase");
    }
    if (phase.phaseStatus !== "upcoming") {
      throw new Error("Phase has already started");
    }
    if (phase.playerMeeting !== true) {
      throw new Error("Player meeting is not enabled for this phase");
    }
    if (phase.playerMeetingStatus !== undefined) {
      throw new Error("Player meeting has already started");
    }
    if (phase.phaseOrder === 1) {
      if (tournament.lifecycle === "in_progress") {
        throw new Error("Tournament has already started");
      }
    } else {
      const previousPhase = await swissPhaseByOrder(
        ctx,
        tournament._id,
        phase.phaseOrder - 1,
      );
      if (previousPhase?.phaseStatus !== "completed") {
        throw new Error("Previous phase must be completed first");
      }
    }

    const registrations = await activeRegistrations(ctx, tournament._id);
    if (registrations.length < 2) {
      throw new Error("At least two active players are required");
    }

    const players = await Promise.all(
      registrations.map(async (registration) => ({
        registrationId: registration._id,
        playerName:
          registration.playerName ??
          (await registrationDisplayName(ctx, registration._id)) ??
          null,
        createdAt: registration.createdAt,
      })),
    );
    players.sort(comparePlayersAlphabetically);

    const now = Date.now();
    for (const [index, player] of players.entries()) {
      await ctx.db.insert("playerMeetingSeats", {
        tournamentId: tournament._id,
        tournamentPhaseId: phase._id,
        registrationId: player.registrationId,
        playerName: player.playerName,
        tableNumber: Math.floor(index / 2) + 1,
        updatedAt: now,
      });
    }
    await ctx.db.patch(phase._id, {
      playerMeetingStatus: "in_progress",
      updatedAt: now,
    });
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "organizer",
      event: {
        type: "player_meeting_started",
        phaseOrder: phase.phaseOrder,
        playerCount: players.length,
      },
    });
    return args.phaseId;
  },
});

export const listPlayerMeetingSeats = query({
  args: { phaseId: v.id("tournamentPhases") },
  handler: async (ctx, args) => {
    const phase = await requirePhase(ctx, args.phaseId);
    await requireOrganizerAccess(ctx, phase.tournamentId);
    const seats = await meetingSeats(ctx, args.phaseId);
    return {
      meetingStatus: phase.playerMeetingStatus ?? null,
      // Status is joined live so drops (and reinstatements) made during the
      // meeting strike through immediately without touching the seat rows.
      seats: await Promise.all(
        seats.map(async (seat) => ({
          ...seat,
          registrationStatus:
            (await ctx.db.get(seat.registrationId))?.status ?? null,
        })),
      ),
    };
  },
});
