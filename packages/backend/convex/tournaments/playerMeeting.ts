import { v } from "convex/values";

import {
  DELETED_REGISTRATION_STATUS,
  effectiveRegistrationStatus,
} from "@paper-pairings/shared/registration-status";

import { mutation, query } from "../_generated/server";
import { DATABASE_IO_BATCH_SIZE, mapAsyncInBatches } from "../model/batching";
import { meetingSeats, requirePhase } from "../model/phases";
import { startPlayerMeeting as startPlayerMeetingTransition } from "../model/progression";
import { requireOrganizerAccess } from "../model/tournaments";

export const startPlayerMeeting = mutation({
  args: { phaseId: v.id("tournamentPhases") },
  handler: async (ctx, args) => {
    const phase = await requirePhase(ctx, args.phaseId);
    const access = await requireOrganizerAccess(ctx, phase.tournamentId);
    return await startPlayerMeetingTransition(ctx, access, phase);
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
        async (seat) => {
          const registration = await ctx.db.get(seat.registrationId);
          return {
            ...seat,
            // A deleted registration is a different situation from a
            // malformed-but-present row (effectiveRegistrationStatus's own
            // fallback) — label it distinctly so the two never collapse into
            // the same value for the client.
            registrationStatus: registration
              ? effectiveRegistrationStatus(registration)
              : DELETED_REGISTRATION_STATUS,
          };
        },
      ),
    };
  },
});
