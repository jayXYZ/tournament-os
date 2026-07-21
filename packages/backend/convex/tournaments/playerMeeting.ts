import { v } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { logAuditEvent } from "../model/auditLog";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import { cutoffQualifiers } from "../model/cutoffs";
import {
  SWISS_FORMAT,
  meetingSeats,
  requirePhase,
  swissPhaseByOrder,
} from "../model/phases";
import {
  activeRegistrations,
  comparePlayersAlphabetically,
  resolveRegistrationDisplayName,
} from "../model/registrations";
import { requireOrganizerAccess } from "../model/tournaments";

// Seats the phase's player pool for its player meeting: alphabetical order,
// two per table (players 1&2 at table 1, 3&4 at table 2, an odd player alone
// at the last table). The pool is every active player, unless the previous
// phase configured a cutoff — then only its qualifiers are seated, matching
// the cut startNextPhaseFirstRound applies when round 1 is paired. That cutoff
// meeting snapshot remains authoritative through pairing, while live status
// still removes dropped qualifiers. Attendance drops happen through the normal
// dropRegistration flow and readers live-join registration status, so seat
// rows are never rewritten.
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
    let registrations: Doc<"tournamentRegistrations">[];
    if (phase.phaseOrder === 1) {
      if (tournament.lifecycle !== "registration") {
        throw new Error(
          "Tournament must be published before the meeting starts",
        );
      }
      registrations = await activeRegistrations(ctx, tournament._id);
    } else {
      if (tournament.lifecycle !== "in_progress") {
        throw new Error("Tournament is not in progress");
      }
      const previousPhase = await swissPhaseByOrder(
        ctx,
        tournament._id,
        phase.phaseOrder - 1,
      );
      if (previousPhase?.phaseStatus !== "completed") {
        throw new Error("Previous phase must be completed first");
      }
      // The cut is enforced on registrations only when round 1 is paired, but
      // the meeting freezes its entry field from the previous phase's final
      // standings — seat only the players who made it.
      if (previousPhase.phaseCutoff !== null) {
        if (!previousPhase.phaseCurrentRound) {
          throw new Error("Previous phase's final round not found");
        }
        registrations = await cutoffQualifiers(
          ctx,
          previousPhase.phaseCurrentRound,
          previousPhase.phaseCutoff,
        );
        if (registrations.length < 2) {
          throw new Error(
            "The phase cutoff leaves fewer than two qualifying players",
          );
        }
      } else {
        registrations = await activeRegistrations(ctx, tournament._id);
      }
    }
    if (registrations.length < 2) {
      throw new Error("At least two active players are required");
    }

    const players = await mapAsyncInBatches(
      registrations,
      DATABASE_IO_BATCH_SIZE,
      async (registration) => ({
        registrationId: registration._id,
        playerName:
          (await resolveRegistrationDisplayName(
            ctx,
            registration.playerName,
            registration._id,
          )) ?? null,
        createdAt: registration.createdAt,
      }),
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
      seats: await mapAsyncInBatches(
        seats,
        DATABASE_IO_BATCH_SIZE,
        async (seat) => ({
          ...seat,
          registrationStatus:
            (await ctx.db.get(seat.registrationId))?.status ?? null,
        }),
      ),
    };
  },
});
