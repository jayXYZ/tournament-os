// @vitest-environment jsdom

import { act, forwardRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { JoinLinkCard } from './join-link-card'
import type {
  Doc,
  Id,
} from '@paper-pairings/backend/convex/_generated/dataModel'
import type { Root } from 'react-dom/client'

// What a scanner would read: each QR component renders the value it was
// asked to encode, so the test checks the encoded URL itself, not the text
// printed beside it.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <svg data-qr="svg" data-value={value} />
  ),
  QRCodeCanvas: forwardRef<HTMLCanvasElement, { value: string }>(
    ({ value }, ref) => (
      <canvas ref={ref} data-qr="canvas" data-value={value} />
    ),
  ),
}))

// The private event's invite, as getInviteLink would return it.
const invite = { code: 'ABCDEFGHJK' }
vi.mock('convex/react', () => ({
  useQuery: () => invite,
  useMutation: () => vi.fn(),
}))

function tournament(
  visibility: Doc<'tournaments'>['visibility'],
): Doc<'tournaments'> {
  return {
    _id: 'tournament' as Id<'tournaments'>,
    _creationTime: 0,
    name: 'Store Championship',
    publicCode: '7K3M9Q',
    organizationId: 'organization' as Id<'organizations'>,
    createdBy: 'user' as Id<'users'>,
    visibility,
    lifecycle: 'registration',
    startDate: 0,
    playerCapacity: 16,
    format: 'standard',
    isTestEvent: false,
    autoPublishPairings: false,
    decklistRequired: false,
    registrationRequiresApproval: false,
    confirmedRegistrationCount: 0,
    seed: 1,
    updatedAt: 0,
  }
}

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

function render(visibility: Doc<'tournaments'>['visibility']) {
  act(() => {
    root.render(<JoinLinkCard tournament={tournament(visibility)} />)
  })
}

function dialog() {
  return document.body.querySelector('[role="dialog"]')
}

// Every QR rendering on the page, sorted by kind: the hidden canvas the PNG
// download comes from, then the dialog's and the print sheet's SVGs (their
// DOM order depends on when each portal mounted).
function encodedValues() {
  return [...document.body.querySelectorAll('[data-qr]')]
    .map((element) => [
      element.getAttribute('data-qr'),
      element.getAttribute('data-value'),
    ])
    .sort(([a], [b]) => (a ?? '').localeCompare(b ?? ''))
}

function openQrDialog() {
  const button = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === 'Show QR code',
  )
  expect(button).toBeDefined()
  act(() => {
    button!.click()
  })
  expect(dialog()).not.toBeNull()
}

test('a public event encodes its public code in every QR rendering', () => {
  render('public')
  openQrDialog()
  const url = `${window.location.origin}/join/7K3M9Q`
  expect(encodedValues()).toEqual([
    ['canvas', url],
    ['svg', url],
    ['svg', url],
  ])
})

test('an open QR dialog stays open and switches codes when the event goes private', () => {
  render('public')
  openQrDialog()

  render('private')
  expect(dialog()).not.toBeNull()
  const url = `${window.location.origin}/join/ABCDEFGHJK`
  expect(encodedValues()).toEqual([
    ['canvas', url],
    ['svg', url],
    ['svg', url],
  ])
})
