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

const unfiltered: ColumnFiltersState = []
const modernOnly: ColumnFiltersState = [{ id: 'format', value: ['modern'] }]

function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  return {
    render(data: Array<TestRow>, columnFilters: ColumnFiltersState) {
      return act(() =>
        root.render(
          <DataTable
            columns={columns}
            data={data}
            getRowId={(row) => row.id}
            getSubRows={(row) => row.events}
            columnFilters={columnFilters}
            onColumnFiltersChange={() => {}}
          />,
        ),
      )
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
