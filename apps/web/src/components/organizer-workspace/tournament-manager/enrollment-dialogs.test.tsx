// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import {
  AddGuestDialog,
  ContinueAsGuestDialog,
  EnrollPlayerDialog,
} from './enrollment-dialogs'
import type {
  Doc,
  Id,
} from '@paper-pairings/backend/convex/_generated/dataModel'

// The two enrollments and the naming follow-up each ask for exactly one
// thing and send exactly that: "Enroll player" an email, "Add guest" a name,
// "Continue as guest" a name. The mutation is a recorded stub, so the test
// pins the arguments each dialog sends — the backend's contract — and that
// neither enrollment form carries the other's field.

const mutations = vi.hoisted(() => ({
  calls: [] as Array<unknown>,
  mutate: vi.fn((args: unknown) => {
    mutations.calls.push(args)
    return Promise.resolve('registration-1')
  }),
}))

vi.mock('convex/react', () => ({
  useMutation: () => mutations.mutate,
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const openTournament = {
  _id: 'tournament-1',
  lifecycle: 'registration',
  confirmedRegistrationCount: 3,
  playerCapacity: 8,
} as unknown as Doc<'tournaments'>

let container: HTMLDivElement
let root: ReturnType<typeof createRoot>

function mount(element: React.ReactElement) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  return act(() => root.render(element))
}

afterEach(async () => {
  await act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ''
  mutations.calls.length = 0
  vi.unstubAllGlobals()
})

function triggerButton(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent.trim() === label,
  )
  if (!button) throw new Error(`${label} button not found`)
  return button
}

// Dialogs portal into the body, so form controls are looked up there.
function dialogInputs() {
  return Array.from(
    document.body.querySelectorAll<HTMLInputElement>('[role="dialog"] input'),
  )
}

function dialogForm() {
  const form = document.body.querySelector<HTMLFormElement>(
    '[role="dialog"] form',
  )
  if (!form) throw new Error('dialog form not found')
  return form
}

// React tracks the input's value through its own setter, so the native one
// is used to change it from outside before the event fires.
async function typeInto(input: HTMLInputElement, value: string) {
  const { set } = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ) as PropertyDescriptor
  await act(() => {
    set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

test('Enroll player asks for an email only and sends it', async () => {
  await mount(<EnrollPlayerDialog tournament={openTournament} />)
  expect(triggerButton('Enroll player').disabled).toBe(false)
  await act(() => triggerButton('Enroll player').click())

  const inputs = dialogInputs()
  expect(inputs).toHaveLength(1)
  expect(inputs[0].type).toBe('email')
  expect(inputs[0].required).toBe(true)
  // Nothing about accounts, no name field.
  expect(document.body.textContent).not.toMatch(/\bName\b|account/)

  await typeInto(inputs[0], ' Jordan@Example.com ')
  await act(() => dialogForm().requestSubmit())
  expect(mutations.calls).toEqual([
    { tournamentId: 'tournament-1', email: 'Jordan@Example.com' },
  ])
})

test('Add guest asks for a name only and sends it', async () => {
  await mount(<AddGuestDialog tournament={openTournament} />)
  await act(() => triggerButton('Add guest').click())

  const inputs = dialogInputs()
  expect(inputs).toHaveLength(1)
  expect(inputs[0].type).toBe('text')
  expect(inputs[0].required).toBe(true)
  expect(inputs[0].maxLength).toBe(80)
  // No email field.
  expect(document.body.textContent).not.toMatch(/\bEmail\b/)

  await typeInto(inputs[0], 'Jordan Lee')
  await act(() => dialogForm().requestSubmit())
  expect(mutations.calls).toEqual([
    { tournamentId: 'tournament-1', displayName: 'Jordan Lee' },
  ])
})

test('both enrollments are offered only while a seat can be taken', async () => {
  const full = { ...openTournament, confirmedRegistrationCount: 8 }
  await mount(
    <>
      <EnrollPlayerDialog tournament={full} />
      <AddGuestDialog tournament={full} />
    </>,
  )
  expect(triggerButton('Enroll player').disabled).toBe(true)
  expect(triggerButton('Add guest').disabled).toBe(true)
})

test('Continue as guest names one registration for this event', async () => {
  const onOpenChange = vi.fn()
  await mount(
    <ContinueAsGuestDialog
      open
      onOpenChange={onOpenChange}
      registrationId={'registration-1' as Id<'tournamentRegistrations'>}
      currentLabel="jordan@example.com"
    />,
  )
  // The organizer sees who they are naming, identified by the email.
  expect(document.body.textContent).toContain(
    'Continue jordan@example.com as a guest',
  )
  const inputs = dialogInputs()
  expect(inputs).toHaveLength(1)
  expect(inputs[0].required).toBe(true)

  await typeInto(inputs[0], 'Jordan Lee')
  await act(() => dialogForm().requestSubmit())
  expect(mutations.calls).toEqual([
    { registrationId: 'registration-1', displayName: 'Jordan Lee' },
  ])
  expect(onOpenChange).toHaveBeenCalledWith(false)
})
