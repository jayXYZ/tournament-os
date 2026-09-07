import { auditPlayerRef, logAuditEvent } from "./auditLog";
import {
  MAX_CARD_NAME_LENGTH,
  MAX_DECK_NAME_LENGTH,
} from "@tournament-os/shared/decklist-limits";
import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { decklistCardEntryValidator } from "../validators";

export type DecklistCardEntry = Infer<typeof decklistCardEntryValidator>;

// Structural sanity bounds, not format legality: each is far beyond any real
// deck (even 240-card novelty builds) while keeping a hostile client from
// writing near-1MB documents. Format rules (60-card minimums, 4-of caps) are
// a human deck-check concern — see decklistCardEntryValidator. The two
// name-length caps live in @tournament-os/shared (re-exported here) so client
// inputs cap entry at exactly the limit enforced below.
export const MAX_BOARD_ENTRIES = 500;
export const MAX_BOARD_CARDS = 5000;
export { MAX_CARD_NAME_LENGTH, MAX_DECK_NAME_LENGTH };
export const MAX_RAW_TEXT_LENGTH = 64 * 1024;

// Validates and canonicalizes one board's entries: names are trimmed and
// must be nonempty, quantities must be positive integers, and entries naming
// the same card (case-insensitively — client parsers disagree on casing) are
// merged into the first occurrence so readers can treat entries as unique by
// name. Order is otherwise preserved as submitted. `label` names the board in
// error messages shown to the player.
export function normalizeBoard(
  label: string,
  entries: DecklistCardEntry[],
): DecklistCardEntry[] {
  if (entries.length > MAX_BOARD_ENTRIES) {
    throw new Error(`${label} has more than ${MAX_BOARD_ENTRIES} entries`);
  }
  const byNameKey = new Map<string, DecklistCardEntry>();
  let totalCards = 0;
  for (const entry of entries) {
    const name = entry.name.trim();
    if (name.length === 0) {
      throw new Error(`${label} contains an entry with an empty card name`);
    }
    if (name.length > MAX_CARD_NAME_LENGTH) {
      throw new Error(`${label} contains a card name that is too long`);
    }
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1) {
      throw new Error(
        `${label}: card quantities must be positive whole numbers`,
      );
    }
    totalCards += entry.quantity;
    const key = name.toLowerCase();
    const existing = byNameKey.get(key);
    if (existing) {
      existing.quantity += entry.quantity;
    } else {
      byNameKey.set(key, { name, quantity: entry.quantity });
    }
  }
  if (totalCards > MAX_BOARD_CARDS) {
    throw new Error(`${label} has more than ${MAX_BOARD_CARDS} cards`);
  }
  return [...byNameKey.values()];
}

export function boardCardCount(entries: DecklistCardEntry[]): number {
  return entries.reduce((total, entry) => total + entry.quantity, 0);
}

// The registration's decklist, or null before one is submitted. The
// by_registrationId upsert in submitMyDecklist is the only writer, so
// .unique() doubles as the one-list-per-registration invariant check.
export async function decklistForRegistration(
  ctx: QueryCtx,
  registrationId: Id<"tournamentRegistrations">,
) {
  return await ctx.db
    .query("tournamentDecklists")
    .withIndex("by_registrationId", (q) =>
      q.eq("registrationId", registrationId),
    )
    .unique();
}

// The decklist surface for one registration: the stored list (null before a
// submission) and the server's verdict on whether submitMyDecklist would
// accept a (re)submission right now. Shared by the player and organizer
// getters — getMyDecklist and getDecklistForRegistration — which differ only
// in how they authorize their way to the registration.
export async function getDecklist(
  ctx: QueryCtx,
  tournament: Doc<"tournaments">,
  registration: Doc<"tournamentRegistrations">,
) {
  return {
    decklist: await decklistForRegistration(ctx, registration._id),
    submissionOpen: decklistSubmissionOpen(tournament, registration),
  };
}

// Whether this registration may submit (or replace) its decklist right now.
// Open exactly while the tournament is in the "registration" lifecycle: round
// 1 is paired in the same transaction that moves the tournament to
// "in_progress" (see startTournament), and pre-start deck building for
// limited formats — the player-meeting window — happens while the lifecycle
// is still "registration", so one rule covers constructed and sealed/draft
// alike. Enforced by submitMyDecklist and reported to the client by
// getMyDecklist (the registrationDropEffect pattern), so the editor's
// enabled state never re-derives the rule.
export function decklistSubmissionOpen(
  tournament: Doc<"tournaments">,
  registration: Doc<"tournamentRegistrations">,
): boolean {
  return (
    tournament.decklistRequired &&
    tournament.lifecycle === "registration" &&
    registration.entryStatus === "confirmed" &&
    registration.participationStatus === "active"
  );
}

export async function submitDecklist(
  ctx: MutationCtx,
  {
    tournament,
    registration,
    user,
  }: {
    tournament: Doc<"tournaments">;
    registration: Doc<"tournamentRegistrations">;
    user: Doc<"users">;
  },
  args: {
    deckName?: string;
    maindeck: DecklistCardEntry[];
    sideboard: DecklistCardEntry[];
    rawText?: string;
  },
): Promise<Id<"tournamentDecklists">> {
  // Checked separately from the open/closed gate below so an event that
  // never collects decklists doesn't report itself as merely "closed".
  if (!tournament.decklistRequired) {
    throw new Error("This tournament does not collect decklists");
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
  if (args.rawText !== undefined && args.rawText.length > MAX_RAW_TEXT_LENGTH) {
    throw new Error("Decklist text is too long");
  }

  const existing = await decklistForRegistration(ctx, registration._id);
  const decklist = {
    tournamentId: tournament._id,
    registrationId: registration._id,
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
  // Write the roster's denormalized copy through (see the schema comment on
  // tournamentRegistrations). deckName is patched even when undefined so a
  // resubmission that dropped the name clears the copy too.
  await ctx.db.patch(registration._id, {
    decklistId,
    deckName,
    updatedAt: decklist.updatedAt,
  });
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
}
