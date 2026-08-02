import type { Infer } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { decklistCardEntryValidator } from "../validators";

export type DecklistCardEntry = Infer<typeof decklistCardEntryValidator>;

// Structural sanity bounds, not format legality: each is far beyond any real
// deck (even 240-card novelty builds) while keeping a hostile client from
// writing near-1MB documents. Format rules (60-card minimums, 4-of caps) are
// a human deck-check concern — see decklistCardEntryValidator.
export const MAX_BOARD_ENTRIES = 500;
export const MAX_BOARD_CARDS = 5000;
export const MAX_CARD_NAME_LENGTH = 200;
export const MAX_DECK_NAME_LENGTH = 200;
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
    tournament.lifecycle === "registration" &&
    registration.entryStatus === "confirmed" &&
    registration.participationStatus === "active"
  );
}
