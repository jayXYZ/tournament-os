// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { TimeExtensionDialog } from './time-extension-dialog'
import type { PairingRow } from './pairing-row'

// The dialog works on the match as it was when it opened. When another staff
// member's change arrives underneath it, no button may change what it does:
// the form keeps its draft, switches its actions off, and loads the current
// extension only when asked. The mutation is a recorded stub, so the test
// pins what is (and is not) sent.

const mutations = vi.hoisted(() => ({
  calls: [] as Array<unknown>,
  mutate: vi.fn((args: unknown) => {
    mutations.calls.push(args)
    return Promise.resolve('match-1')
  }),
}))

vi.mock('convex/react', () => ({
  useMutation: () => mutations.mutate,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

function row(revision: number, extensionMinutes: number | null) {
  return {
    match: {
      _id: 'match-1',
      tableNumber: 3,
      matchStatus: 'in_progress',
      timeExtensionRevision: revision,
      ...(extensionMinutes === null
        ? {}
        : {
            timeExtension: {
              extensionMs: extensionMinutes * 60_000,
              overtimeCreditMs: 0,
              setAt: 1,
            },
          }),
    },
    players: [],
  } as unknown as PairingRow
}

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function render(pairingRow: PairingRow) {
  return act(() =>
    root.render(
      <TimeExtensionDialog
        row={pairingRow}
        finished={false}
        open
        onOpenChange={() => {}}
      />,
    ),
  )
}

function mount(pairingRow: PairingRow) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  return render(pairingRow)
}

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  mutations.calls.length = 0
  vi.unstubAllGlobals()
})

// Dialogs portal into the body.
function button(label: string) {
  const found = Array.from(
    document.body.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'),
  ).find((candidate) => candidate.textContent.trim() === label)
  if (!found) throw new Error(`${label} button not found`)
  return found
}

function minutesInput() {
  const input = document.body.querySelector<HTMLInputElement>(
    '[role="dialog"] input[type="number"]',
  )
  if (!input) throw new Error('minutes input not found')
  return input
}

function dialogTitle() {
  return document.body.querySelector('[role="dialog"] h2')?.textContent
}

function submit() {
  const form = document.body.querySelector('[role="dialog"] form')
  if (!form) throw new Error('form not found')
  return act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

test('a save sends the revision the form opened with', async () => {
  await mount(row(1, 8))
  expect(dialogTitle()).toBe('Edit time extension')
  expect(minutesInput().value).toBe('8')

  await submit()
  expect(mutations.calls).toEqual([
    { matchId: 'match-1', minutes: 8, expectedRevision: 1 },
  ])
})

test("another staff member's change freezes the form instead of replacing it", async () => {
  await mount(row(1, 8))
  // Someone else removes the extension while this dialog is open.
  await render(row(2, null))

  // Still the edit form on the +8 it opened with, with nothing to click
  // through to a different action.
  expect(dialogTitle()).toBe('Edit time extension')
  expect(minutesInput().value).toBe('8')
  expect(button('Save extension').disabled).toBe(true)
  expect(button('Remove extension').disabled).toBe(true)
  await submit()
  expect(mutations.calls).toEqual([])

  // Loading is explicit, and only then does the form describe the match as
  // it is now.
  await act(() => button('Load current').click())
  expect(dialogTitle()).toBe('Add time extension')
  expect(minutesInput().value).toBe('5')
  await submit()
  expect(mutations.calls).toEqual([
    { matchId: 'match-1', minutes: 5, expectedRevision: 2 },
  ])
})
