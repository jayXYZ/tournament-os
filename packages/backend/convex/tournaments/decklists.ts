import { v } from "convex/values";

import type { Id } from "../_generated/dataModel";
import { mutation, query } from "../_generated/server";
import { currentUserOrNull } from "../model/access";
import { auditPlayerRef, logAuditEvent } from "../model/auditLog";
import {
  boardCardCount,
  decklistForRegistration,
  decklistSubmissionOpen,
  MAX_DECK_NAME_LENGTH,
  MAX_RAW_TEXT_LENGTH,
  normalizeBoard,
} from "../model/decklists";
import { playerDisplayName, registrationForUser } from "../model/registrations";
import { requireTournament } from "../model/tournaments";
import { ensureCurrentUser } from "../model/users";
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
    if (!decklistSubmissionOpen(tournament, registration)) {
      throw new Error("Decklist submission is closed for this tournament");
    }

    const maindeck = normalizeBoard("Maindeck", args.maindeck);
    if (maindeck.length === 0) {
      throw new Error("Maindeck cannot be empty");
    }
    const sideboard = normalizeBoard("Sideboard", args.sideboard);
    // An all-whitespace deck name reads as "left blank", not as a name.
    const deckName = args.deckName?.trim() || undefined;
    if (deckName !== undefined && deckName.length > MAX_DECK_NAME_LENGTH) {
      throw new Error("Deck name is too long");
    }
    if (
      args.rawText !== undefined &&
      args.rawText.length > MAX_RAW_TEXT_LENGTH
    ) {
      throw new Error("Decklist text is too long");
    }

    const existing = await decklistForRegistration(ctx, registration._id);
    const decklist = {
      tournamentId: tournament._id,
      registrationId: registration._id,
      playerName: registration.playerName ?? playerDisplayName(user) ?? null,
      deckName,
      maindeck,
      sideboard,
      rawText: args.rawText,
      updatedAt: Date.now(),
    };
    let decklistId: Id<"tournamentDecklists">;
    if (existing) {
      // replace, not patch: a resubmission is a complete statement of the
      // list, so optional fields omitted this time (deckName, rawText) clear
      // instead of surviving from the previous submission.
      await ctx.db.replace(existing._id, decklist);
      decklistId = existing._id;
    } else {
      decklistId = await ctx.db.insert("tournamentDecklists", decklist);
    }
    await logAuditEvent(ctx, {
      tournamentId: tournament._id,
      actor: user,
      actorRole: "player",
      event: {
        type: "decklist_submitted",
        player: auditPlayerRef(registration),
        maindeckCardCount: boardCardCount(maindeck),
        sideboardCardCount: boardCardCount(sideboard),
        isUpdate: existing !== null,
      },
    });
    return decklistId;
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
    return {
      decklist: await decklistForRegistration(ctx, registration._id),
      submissionOpen: decklistSubmissionOpen(tournament, registration),
    };
  },
});
