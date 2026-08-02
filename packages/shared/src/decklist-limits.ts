// Maximum lengths the backend enforces on decklist submissions (see
// packages/backend/convex/model/decklists.ts, which re-exports these next to
// its server-only bounds). Shared so client inputs cap entry at exactly the
// limit the server will accept, instead of hard-coding numbers that can drift.
export const MAX_CARD_NAME_LENGTH = 200;
export const MAX_DECK_NAME_LENGTH = 200;
