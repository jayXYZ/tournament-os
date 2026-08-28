// Pure state helpers for the decklist editor. The draft mirrors the
// submitMyDecklist payload: two boards of { name, quantity } entries, unique
// by name case-insensitively (the server merges duplicates the same way, so
// what the player sees is what gets stored).

export type DraftEntry = { name: string; quantity: number }

export type BoardId = 'maindeck' | 'sideboard'

export type DecklistDraft = {
  deckName: string
  maindeck: Array<DraftEntry>
  sideboard: Array<DraftEntry>
}

// UI ceiling per entry, far above any real deck's needs while keeping the
// stepper and quantity-prefix parsing from producing absurd counts. The
// server's own bounds are per-board, not per-entry (see model/decklists.ts).
export const MAX_QUANTITY = 99

export const otherBoard = (board: BoardId): BoardId =>
  board === 'maindeck' ? 'sideboard' : 'maindeck'

// Splits an optional quantity prefix off a typed entry: "4 Lightning Bolt"
// and "4x Lightning Bolt" both mean four copies. Only 1–2 digit prefixes
// count as quantities — card names can begin with longer numbers ("1996
// World Champion"), and no one adds a hundred copies of anything.
export function parseCardInput(raw: string): {
  quantity: number
  name: string
} {
  const match = /^\s*(\d{1,2})\s*[xX]?\s+(\S.*)$/.exec(raw)
  if (match) {
    const quantity = Number.parseInt(match[1], 10)
    if (quantity >= 1) {
      return {
        quantity: Math.min(quantity, MAX_QUANTITY),
        name: match[2].trim(),
      }
    }
  }
  return { quantity: 1, name: raw.trim() }
}

const entryKey = (name: string) => name.trim().toLowerCase()

export function findEntry(
  entries: Array<DraftEntry>,
  name: string,
): DraftEntry | undefined {
  const key = entryKey(name)
  return entries.find((entry) => entryKey(entry.name) === key)
}

// Adds copies of a card to a board, merging into an existing entry that names
// the same card (any casing). New cards append at the end, so the list reads
// in the order the player entered it.
export function addToBoard(
  entries: Array<DraftEntry>,
  name: string,
  quantity: number,
): Array<DraftEntry> {
  const existing = findEntry(entries, name)
  if (existing) {
    return entries.map((entry) =>
      entry === existing
        ? {
            ...entry,
            quantity: Math.min(entry.quantity + quantity, MAX_QUANTITY),
          }
        : entry,
    )
  }
  return [
    ...entries,
    { name: name.trim(), quantity: Math.min(quantity, MAX_QUANTITY) },
  ]
}

// Sets an entry's count directly; clamps to 1..MAX_QUANTITY. Removing is an
// explicit separate action so a stray extra tap on “−” can't silently drop a
// card from the list.
export function setBoardQuantity(
  entries: Array<DraftEntry>,
  name: string,
  quantity: number,
): Array<DraftEntry> {
  const clamped = Math.min(Math.max(quantity, 1), MAX_QUANTITY)
  const key = entryKey(name)
  return entries.map((entry) =>
    entryKey(entry.name) === key ? { ...entry, quantity: clamped } : entry,
  )
}

export function removeFromBoard(
  entries: Array<DraftEntry>,
  name: string,
): Array<DraftEntry> {
  const key = entryKey(name)
  return entries.filter((entry) => entryKey(entry.name) !== key)
}

// Moves an entry (all copies) to the other board, merging with a same-named
// entry already there.
export function moveBetweenBoards(
  draft: DecklistDraft,
  from: BoardId,
  name: string,
): DecklistDraft {
  const entry = findEntry(draft[from], name)
  if (!entry) {
    return draft
  }
  const to = otherBoard(from)
  return {
    ...draft,
    [from]: removeFromBoard(draft[from], name),
    [to]: addToBoard(draft[to], entry.name, entry.quantity),
  }
}

export function boardCount(entries: Array<DraftEntry>): number {
  return entries.reduce((total, entry) => total + entry.quantity, 0)
}

export function draftsEqual(a: DecklistDraft, b: DecklistDraft): boolean {
  return (
    a.deckName.trim() === b.deckName.trim() &&
    boardsEqual(a.maindeck, b.maindeck) &&
    boardsEqual(a.sideboard, b.sideboard)
  )
}

function boardsEqual(a: Array<DraftEntry>, b: Array<DraftEntry>): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.name === b[index].name && entry.quantity === b[index].quantity,
    )
  )
}
