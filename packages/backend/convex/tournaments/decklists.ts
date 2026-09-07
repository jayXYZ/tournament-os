import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { currentUserOrNull } from "../model/access";
import { submitDecklist, getDecklist } from "../model/decklists";
import {
  registrationForUser,
  requireRegistration,
} from "../model/registrations";
import {
  requireOrganizerAccess,
  requireTournament,
} from "../model/tournaments";
import { ensureCurrentUser } from "../model/users";
import { enforceRateLimit } from "../rateLimits";
import { decklistCardEntryValidator } from "../validators";

// Creates or wholly replaces the caller's decklist for the tournament. The
// client sends parsed entries (plus, when the list came from a paste, the
// original text); the server re-validates and canonicalizes them — merged
// duplicates, trimmed names, integer quantities — so the stored form never
// depends on client behavior.
export const submitMyDecklist = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    deckName: v.optional(v.string()),
    maindeck: v.array(decklistCardEntryValidator),
    sideboard: v.array(decklistCardEntryValidator),
    rawText: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"tournamentDecklists">> => {
    await enforceRateLimit(ctx, "submitDecklist");
    const user = await ensureCurrentUser(ctx);
    const tournament = await requireTournament(ctx, args.tournamentId);
    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (!registration) {
      throw new Error("You are not registered for this tournament");
    }
    return await submitDecklist(ctx, { tournament, registration, user }, args);
  },
});

// The caller's decklist for the tournament, with the server's verdict on
// whether submitMyDecklist would accept a (re)submission right now. Null when
// the caller is signed out or holds no confirmed entry — indistinguishable on
// purpose, matching getMyRegistration's contract; a registered player who has
// not submitted yet gets { decklist: null, submissionOpen: true }.
export const getMyDecklist = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const user = await currentUserOrNull(ctx);
    if (!user) {
      return null;
    }
    const tournament = await ctx.db.get(args.tournamentId);
    if (!tournament) {
      return null;
    }
    const registration = await registrationForUser(
      ctx,
      args.tournamentId,
      user._id,
    );
    if (!registration || registration.entryStatus !== "confirmed") {
      return null;
    }
    return await getDecklist(ctx, tournament, registration);
  },
});

// One player's decklist as the organizer deck-check surface opens it from a
// roster row. Same shape as getMyDecklist; only the authorization differs.
// No confirmed-entry gate: a cancelled row's surviving list stays readable to
// staff, and submissionOpen already reports it frozen.
export const getDecklistForRegistration = query({
  args: { registrationId: v.id("tournamentRegistrations") },
  handler: async (ctx, args) => {
    const registration = await requireRegistration(ctx, args.registrationId);
    const { tournament } = await requireOrganizerAccess(
      ctx,
      registration.tournamentId,
    );
    return await getDecklist(ctx, tournament, registration);
  },
});
