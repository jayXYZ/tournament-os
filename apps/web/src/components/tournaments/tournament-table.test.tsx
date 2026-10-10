// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { TournamentTable } from './tournament-table'
import type { ReactNode } from 'react'
import type { Root } from 'react-dom/client'
import type { Id } from '@paper-pairings/backend/convex/_generated/dataModel'
import type { TournamentTableItem } from './tournament-table'

// The table's row links and manage-row navigation want a router; nothing
// here follows one.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  useNavigate: () => () => undefined,
}))

function item(
  name: string,
  format: 'modern' | 'draft',
  startDate: number,
): TournamentTableItem {
  return {
    key: name,
    organizationName: 'Paper Pairings',
    registeredCount: 4,
    tournament: {
      _id: name as Id<'tournaments'>,
      name,
      publicCode: 1,
      format,
      lifecycle: 'registration',
      startDate,
      playerCapacity: 16,
      isTestEvent: false,
    },
  }
}

// Soonest first, the order the public table keeps.
const items = [
  item('Modern Cup', 'modern', 1_760_000_000_000),
  item('Draft Open', 'draft', 1_760_086_400_000),
]

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.unstubAllGlobals()
})

type Props = Parameters<typeof TournamentTable>[0]

function render(props: Partial<Props>) {
  act(() => {
    root.render(<TournamentTable variant="public" items={items} {...props} />)
  })
}

function toolbar() {
  return container.querySelector('[data-slot="data-table-toolbar"]')
}

function searchBox() {
  const input = container.querySelector<HTMLInputElement>(
    'input[type="search"]',
  )
  if (input === null) {
    throw new Error('no search box rendered')
  }
  return input
}

function rowNames() {
  return [...container.querySelectorAll('tbody tr')].map(
    (row) => row.querySelector('td')?.textContent,
  )
}

// React reads an input through its own value tracker on the node; setting
// through the prototype goes around it, so the input event reads as a change.
function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set
  act(() => {
    setValue?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('withholds the toolbar, and the filters it holds, while pages are still to come', () => {
  render({ hasUnloadedItems: true })
  expect(toolbar()).toBeNull()
  expect(rowNames()).toEqual(['Modern Cup', 'Draft Open'])

  // The last page lands: the toolbar appears and narrows the whole list.
  render({ hasUnloadedItems: false })
  expect(toolbar()).not.toBeNull()
  type(searchBox(), 'cup')
  expect(rowNames()).toEqual(['Modern Cup'])

  // The open last page grew past its size, so the list is partial again.
  // The search goes with the toolbar rather than narrow rows it cannot see.
  render({ hasUnloadedItems: true })
  expect(toolbar()).toBeNull()
  expect(rowNames()).toEqual(['Modern Cup', 'Draft Open'])

  // Whole once more: the toolbar comes back with the search it was holding.
  render({ hasUnloadedItems: false })
  expect(searchBox().value).toBe('cup')
  expect(rowNames()).toEqual(['Modern Cup'])
})

test('a search the URL holds waits for the list to be whole too', () => {
  const search = { q: 'cup' }
  const onSearchChange = () => undefined
  render({ hasUnloadedItems: true, search, onSearchChange })
  expect(toolbar()).toBeNull()
  expect(rowNames()).toEqual(['Modern Cup', 'Draft Open'])

  render({ hasUnloadedItems: false, search, onSearchChange })
  expect(searchBox().value).toBe('cup')
  expect(rowNames()).toEqual(['Modern Cup'])
})
