import { expect, test } from 'vitest'

import {
  MAX_QUANTITY,
  addToBoard,
  boardCount,
  draftsEqual,
  findEntry,
  moveBetweenBoards,
  otherBoard,
  parseCardInput,
  removeFromBoard,
  setBoardQuantity,
} from './decklist-draft'
import type { DecklistDraft, DraftEntry } from './decklist-draft'

const entries = (...list: Array<[string, number]>): Array<DraftEntry> =>
  list.map(([name, quantity]) => ({ name, quantity }))

const draft = (
  maindeck: Array<DraftEntry>,
  sideboard: Array<DraftEntry> = [],
  deckName = 'My Deck',
): DecklistDraft => ({ deckName, maindeck, sideboard })

test('parseCardInput splits a quantity prefix off the name', () => {
  expect(parseCardInput('4 Lightning Bolt')).toEqual({
    quantity: 4,
    name: 'Lightning Bolt',
  })
  expect(parseCardInput('4x Lightning Bolt')).toEqual({
    quantity: 4,
    name: 'Lightning Bolt',
  })
  expect(parseCardInput('4X Lightning Bolt')).toEqual({
    quantity: 4,
    name: 'Lightning Bolt',
  })
  expect(parseCardInput('  12   Mountain  ')).toEqual({
    quantity: 12,
    name: 'Mountain',
  })
})

test('parseCardInput defaults to one copy when there is no prefix', () => {
  expect(parseCardInput('Lightning Bolt')).toEqual({
    quantity: 1,
    name: 'Lightning Bolt',
  })
  expect(parseCardInput('  Sol Ring  ')).toEqual({
    quantity: 1,
    name: 'Sol Ring',
  })
})

test('parseCardInput leaves names that merely start with digits alone', () => {
  // 3+ digit prefixes are part of the name, not a quantity.
  expect(parseCardInput('1996 World Champion')).toEqual({
    quantity: 1,
    name: '1996 World Champion',
  })
  // A zero prefix is not a valid quantity.
  expect(parseCardInput('0 Ornithopter')).toEqual({
    quantity: 1,
    name: '0 Ornithopter',
  })
  // No whitespace after the prefix means it is not a prefix.
  expect(parseCardInput('4xLightning')).toEqual({
    quantity: 1,
    name: '4xLightning',
  })
  // A bare number has no name to attach to.
  expect(parseCardInput('4')).toEqual({ quantity: 1, name: '4' })
})

test('addToBoard appends new cards in entry order and trims names', () => {
  const board = addToBoard(entries(['Lightning Bolt', 4]), '  Sol Ring ', 1)
  expect(board).toEqual(
    entries(['Lightning Bolt', 4], ['Sol Ring', 1]),
  )
})

test('addToBoard merges into an existing entry case-insensitively', () => {
  const board = addToBoard(entries(['Lightning Bolt', 4]), 'lightning BOLT', 2)
  // The original casing wins; quantities sum.
  expect(board).toEqual(entries(['Lightning Bolt', 6]))
})

test('addToBoard clamps quantities at MAX_QUANTITY', () => {
  expect(addToBoard([], 'Relentless Rats', MAX_QUANTITY + 5)).toEqual(
    entries(['Relentless Rats', MAX_QUANTITY]),
  )
  expect(
    addToBoard(entries(['Relentless Rats', 98]), 'Relentless Rats', 10),
  ).toEqual(entries(['Relentless Rats', MAX_QUANTITY]))
})

test('setBoardQuantity clamps to 1..MAX_QUANTITY and matches case-insensitively', () => {
  const board = entries(['Lightning Bolt', 4], ['Sol Ring', 1])
  expect(setBoardQuantity(board, 'lightning bolt', 2)).toEqual(
    entries(['Lightning Bolt', 2], ['Sol Ring', 1]),
  )
  // Clamping means a stray decrement can never remove the entry.
  expect(setBoardQuantity(board, 'Lightning Bolt', 0)).toEqual(
    entries(['Lightning Bolt', 1], ['Sol Ring', 1]),
  )
  expect(setBoardQuantity(board, 'Lightning Bolt', 500)).toEqual(
    entries(['Lightning Bolt', MAX_QUANTITY], ['Sol Ring', 1]),
  )
})

test('removeFromBoard removes the whole entry case-insensitively', () => {
  const board = entries(['Lightning Bolt', 4], ['Sol Ring', 1])
  expect(removeFromBoard(board, 'LIGHTNING BOLT')).toEqual(
    entries(['Sol Ring', 1]),
  )
  expect(removeFromBoard(board, 'Not In Deck')).toEqual(board)
})

test('findEntry locates entries regardless of casing', () => {
  const board = entries(['Lightning Bolt', 4])
  expect(findEntry(board, ' lightning bolt ')).toBe(board[0])
  expect(findEntry(board, 'Sol Ring')).toBeUndefined()
})

test('moveBetweenBoards moves all copies to the other board', () => {
  const moved = moveBetweenBoards(
    draft(entries(['Lightning Bolt', 4], ['Sol Ring', 1])),
    'maindeck',
    'Lightning Bolt',
  )
  expect(moved.maindeck).toEqual(entries(['Sol Ring', 1]))
  expect(moved.sideboard).toEqual(entries(['Lightning Bolt', 4]))
})

test('moveBetweenBoards merges with a same-named entry on the far side', () => {
  const moved = moveBetweenBoards(
    draft(entries(['Lightning Bolt', 2]), entries(['lightning bolt', 1])),
    'sideboard',
    'lightning bolt',
  )
  expect(moved.sideboard).toEqual([])
  expect(moved.maindeck).toEqual(entries(['Lightning Bolt', 3]))
})

test('moveBetweenBoards leaves the draft untouched for unknown names', () => {
  const original = draft(entries(['Lightning Bolt', 4]))
  expect(moveBetweenBoards(original, 'maindeck', 'Sol Ring')).toBe(original)
})

test('otherBoard flips between the two boards', () => {
  expect(otherBoard('maindeck')).toBe('sideboard')
  expect(otherBoard('sideboard')).toBe('maindeck')
})

test('boardCount totals copies, not entries', () => {
  expect(boardCount([])).toBe(0)
  expect(boardCount(entries(['Lightning Bolt', 4], ['Sol Ring', 1]))).toBe(5)
})

test('draftsEqual ignores deck-name whitespace only', () => {
  const a = draft(entries(['Lightning Bolt', 4]), [], 'Burn')
  expect(draftsEqual(a, draft(entries(['Lightning Bolt', 4]), [], '  Burn  '))).toBe(
    true,
  )
  expect(draftsEqual(a, draft(entries(['Lightning Bolt', 4]), [], 'Bern'))).toBe(
    false,
  )
})

test('draftsEqual detects board differences', () => {
  const base = draft(
    entries(['Lightning Bolt', 4], ['Sol Ring', 1]),
    entries(['Pyroblast', 2]),
  )
  expect(
    draftsEqual(
      base,
      draft(
        entries(['Lightning Bolt', 4], ['Sol Ring', 1]),
        entries(['Pyroblast', 2]),
      ),
    ),
  ).toBe(true)
  // Quantity, order, exact name casing, and board membership all count.
  expect(
    draftsEqual(
      base,
      draft(
        entries(['Lightning Bolt', 3], ['Sol Ring', 1]),
        entries(['Pyroblast', 2]),
      ),
    ),
  ).toBe(false)
  expect(
    draftsEqual(
      base,
      draft(
        entries(['Sol Ring', 1], ['Lightning Bolt', 4]),
        entries(['Pyroblast', 2]),
      ),
    ),
  ).toBe(false)
  expect(
    draftsEqual(
      base,
      draft(
        entries(['lightning bolt', 4], ['Sol Ring', 1]),
        entries(['Pyroblast', 2]),
      ),
    ),
  ).toBe(false)
  expect(
    draftsEqual(
      base,
      draft(entries(['Lightning Bolt', 4], ['Sol Ring', 1])),
    ),
  ).toBe(false)
})
