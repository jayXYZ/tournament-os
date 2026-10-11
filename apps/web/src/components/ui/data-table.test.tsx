// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import { DataTable, oneOfFilter } from './data-table'
import type { ColumnDef, ColumnFiltersState } from '@tanstack/react-table'

type TestRow = {
  id: string
  name: string
  format?: string
  events?: Array<TestRow>
}

const columns: Array<ColumnDef<TestRow>> = [
  {
    id: 'name',
    accessorKey: 'name',
    header: 'Name',
    cell: ({ row }) => (
      <>
        {row.getCanExpand() ? (
          <button
            type="button"
            aria-label={`Toggle ${row.original.name}`}
            aria-expanded={row.getIsExpanded()}
            onClick={() => row.toggleExpanded()}
          />
        ) : null}
        {row.original.name}
      </>
    ),
  },
  {
    id: 'format',
    accessorKey: 'format',
    header: 'Format',
    filterFn: oneOfFilter,
  },
]

const conventions: Array<TestRow> = [
  {
    id: 'grand-prix',
    name: 'Grand Prix',
    events: [
      { id: 'gp-modern', name: 'GP Modern', format: 'modern' },
      { id: 'gp-legacy', name: 'GP Legacy', format: 'legacy' },
    ],
  },
  {
    id: 'open',
    name: 'Open',
    events: [{ id: 'open-legacy', name: 'Open Legacy', format: 'legacy' }],
  },
]

// Flat rows, enough to paginate two to a page.
const events: Array<TestRow> = [
  { id: 'e1', name: 'Event 1', format: 'modern' },
  { id: 'e2', name: 'Event 2', format: 'legacy' },
  { id: 'e3', name: 'Event 3', format: 'modern' },
  { id: 'e4', name: 'Event 4', format: 'legacy' },
  { id: 'e5', name: 'Event 5', format: 'modern' },
]

const unfiltered: ColumnFiltersState = []
const modernOnly: ColumnFiltersState = [{ id: 'format', value: ['modern'] }]

function mount({ pageSize }: { pageSize?: number } = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  return {
    render(data: Array<TestRow>, columnFilters: ColumnFiltersState) {
      return act(async () => {
        root.render(
          <DataTable
            columns={columns}
            data={data}
            pageSize={pageSize}
            pageSizeOptions={pageSize === undefined ? undefined : [pageSize]}
            getRowId={(row) => row.id}
            getSubRows={(row) => row.events}
            columnFilters={columnFilters}
            onColumnFiltersChange={() => {}}
          />,
        )
        // TanStack applies its own page reset from a microtask, so let one
        // pass before the table is read, or a reset would go unnoticed.
        await Promise.resolve()
      })
    },
    names() {
      return Array.from(
        container.querySelectorAll('tbody tr td:first-child'),
      ).map((cell) => cell.textContent)
    },
    toggle(name: string) {
      const button = container.querySelector<HTMLButtonElement>(
        `button[aria-label="Toggle ${name}"]`,
      )
      if (!button) throw new Error(`Toggle for ${name} not found`)
      return button
    },
    page() {
      return (
        Array.from(container.querySelectorAll('p'))
          .map((paragraph) => paragraph.textContent)
          .find((text) => /^Page \d+ of \d+$/.test(text)) ?? null
      )
    },
    next() {
      const button = Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === 'Next',
      )
      if (!button) throw new Error('Next button not found')
      return button
    },
    async unmount() {
      await act(() => root.unmount())
      container.remove()
      vi.unstubAllGlobals()
    },
  }
}

test('collapsing one parent leaves parents hidden by a filter expanded', async () => {
  const table = mount()
  try {
    await table.render(conventions, unfiltered)
    expect(table.names()).toEqual([
      'Grand Prix',
      'GP Modern',
      'GP Legacy',
      'Open',
      'Open Legacy',
    ])

    await table.render(conventions, modernOnly)
    expect(table.names()).toEqual(['Grand Prix', 'GP Modern'])

    await act(() => table.toggle('Grand Prix').click())
    expect(table.names()).toEqual(['Grand Prix'])

    // Open was filtered out at the moment of the toggle; it must come back
    // with its events showing.
    await table.render(conventions, unfiltered)
    expect(table.names()).toEqual(['Grand Prix', 'Open', 'Open Legacy'])
    expect(table.toggle('Grand Prix').getAttribute('aria-expanded')).toBe(
      'false',
    )

    await act(() => table.toggle('Grand Prix').click())
    expect(table.names()).toEqual([
      'Grand Prix',
      'GP Modern',
      'GP Legacy',
      'Open',
      'Open Legacy',
    ])
  } finally {
    await table.unmount()
  }
})

test('a collapsed parent stays collapsed through a filter, and new parents start expanded', async () => {
  const table = mount()
  try {
    await table.render(conventions, unfiltered)
    await act(() => table.toggle('Open').click())
    expect(table.names()).toEqual([
      'Grand Prix',
      'GP Modern',
      'GP Legacy',
      'Open',
    ])

    await table.render(conventions, modernOnly)
    expect(table.names()).toEqual(['Grand Prix', 'GP Modern'])

    await table.render(conventions, unfiltered)
    expect(table.names()).toEqual([
      'Grand Prix',
      'GP Modern',
      'GP Legacy',
      'Open',
    ])

    // A parent that arrives later, as from a live query, opens like the rest.
    await table.render(
      [
        ...conventions,
        {
          id: 'late',
          name: 'Late Addition',
          events: [
            { id: 'late-modern', name: 'Late Modern', format: 'modern' },
          ],
        },
      ],
      unfiltered,
    )
    expect(table.names()).toEqual([
      'Grand Prix',
      'GP Modern',
      'GP Legacy',
      'Open',
      'Late Addition',
      'Late Modern',
    ])
  } finally {
    await table.unmount()
  }
})

test('the page holds across new data arrays and starts over when a filter changes', async () => {
  const table = mount({ pageSize: 2 })
  try {
    await table.render(events, unfiltered)
    expect(table.names()).toEqual(['Event 1', 'Event 2'])
    await act(() => table.next().click())
    expect(table.names()).toEqual(['Event 3', 'Event 4'])
    expect(table.page()).toBe('Page 2 of 3')

    // The same rows in a fresh array, as a live query pushes them.
    await table.render(
      events.map((event) => ({ ...event })),
      unfiltered,
    )
    expect(table.names()).toEqual(['Event 3', 'Event 4'])
    expect(table.page()).toBe('Page 2 of 3')

    // A row changes and another arrives: the page shows the new rows, in
    // place.
    await table.render(
      [
        ...events.map((event) =>
          event.id === 'e3' ? { ...event, name: 'Event 3 (moved)' } : event,
        ),
        { id: 'e6', name: 'Event 6', format: 'legacy' },
      ],
      unfiltered,
    )
    expect(table.names()).toEqual(['Event 3 (moved)', 'Event 4'])
    expect(table.page()).toBe('Page 2 of 3')

    // A filter change starts over on the first page, though the second
    // would still exist.
    await table.render(events, modernOnly)
    expect(table.names()).toEqual(['Event 1', 'Event 3'])
    expect(table.page()).toBe('Page 1 of 2')
  } finally {
    await table.unmount()
  }
})

test('a list that shrinks under the reader falls back to its last page', async () => {
  const table = mount({ pageSize: 2 })
  try {
    await table.render(events, unfiltered)
    await act(() => table.next().click())
    await act(() => table.next().click())
    expect(table.names()).toEqual(['Event 5'])
    expect(table.page()).toBe('Page 3 of 3')

    await table.render(events.slice(0, 3), unfiltered)
    expect(table.names()).toEqual(['Event 3'])
    expect(table.page()).toBe('Page 2 of 2')
  } finally {
    await table.unmount()
  }
})

test('a few parents whose children overflow a page still get the pagination footer', async () => {
  // Two top-level rows, five rows once expanded: pagination slices the
  // expanded rows, so the footer must count them or the second page is
  // unreachable.
  const table = mount({ pageSize: 2 })
  try {
    await table.render(conventions, unfiltered)
    expect(table.names()).toEqual(['Grand Prix', 'GP Modern'])
    expect(table.page()).toBe('Page 1 of 3')
    await act(() => table.next().click())
    expect(table.names()).toEqual(['GP Legacy', 'Open'])
    await act(() => table.next().click())
    expect(table.names()).toEqual(['Open Legacy'])
    expect(table.page()).toBe('Page 3 of 3')
  } finally {
    await table.unmount()
  }
})
