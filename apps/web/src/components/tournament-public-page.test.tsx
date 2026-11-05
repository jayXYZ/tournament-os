// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { getFunctionName } from 'convex/server'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { FunctionReference } from 'convex/server'
import type { Root } from 'react-dom/client'
import type * as Core from '@paper-pairings/core'
import type * as Router from '@tanstack/react-router'
import type {
  Doc,
  Id,
} from '@paper-pairings/backend/convex/_generated/dataModel'

// Characterization rows for the public event page's RegistrationPanel
// (docs/plans/qr-join.md PR 3): one row per branch the panel has, asserting
// what it renders — badges, buttons, links, and notes in document order —
// and, for the actions, which server call each button makes. They pin the
// panel's behavior so moving it onto the shared derivation in
// @paper-pairings/core can be checked against them.
//
// The data hooks are stubbed at their seams: Convex's useQuery answers the
// event and the fee preview, the core hooks answer the auth gate, the
// registration row, and the refund flag, and the web order hook answers the
// order. A null tournament id skips a hook, as the real ones do.

type Gate = 'pending' | 'signedOut' | 'unverified' | 'ready'

type Answers = {
  event: unknown
  viewer: Gate
  registration: unknown
  order: unknown
  refundFlag: unknown
  feePreview: unknown
}

const state = vi.hoisted(() => {
  const answers: Answers = {
    event: undefined,
    viewer: 'ready',
    registration: undefined,
    order: undefined,
    refundFlag: undefined,
    feePreview: undefined,
  }
  return {
    answers,
    registerSelf: vi.fn(),
    cancelMyRegistration: vi.fn(),
    createEntryCheckout: vi.fn(),
    refreshAuth: vi.fn(),
    restartAuth: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
  }
})

vi.mock('convex/react', () => ({
  useQuery: (query: FunctionReference<'query'>, args: unknown) => {
    if (args === 'skip') return undefined
    const name = getFunctionName(query)
    if (name === 'tournaments/lifecycle:getPublicTournament') {
      return state.answers.event
    }
    if (name === 'payments/queries:getFeePreview')
      return state.answers.feePreview
    throw new Error(`Unexpected query ${name}`)
  },
  useMutation: (mutation: FunctionReference<'mutation'>) => {
    const name = getFunctionName(mutation)
    if (name === 'tournaments/registrations:registerSelf') {
      return state.registerSelf
    }
    if (name === 'tournaments/registrations:cancelMyRegistration') {
      return state.cancelMyRegistration
    }
    throw new Error(`Unexpected mutation ${name}`)
  },
  useAction: () => state.createEntryCheckout,
}))

vi.mock('@paper-pairings/core', async (importOriginal) => ({
  ...(await importOriginal<typeof Core>()),
  useViewerAuthGate: () => state.answers.viewer,
  useMyRegistration: (id: string | null) =>
    id === null ? undefined : state.answers.registration,
  useMyRefundFlag: (id: string | null) =>
    id === null ? undefined : state.answers.refundFlag,
  useRestartConvexAuth: () => state.restartAuth,
}))

vi.mock('@/hooks/use-my-order', () => ({
  useMyEntryOrder: (id: string | null) =>
    id === null ? undefined : state.answers.order,
}))

vi.mock('@/lib/use-app-auth', () => ({
  useAppAuth: () => ({
    user:
      state.answers.viewer === 'signedOut' ? null : { email: 'p@example.com' },
    loading: state.answers.viewer === 'pending',
    refreshAuth: state.refreshAuth,
    signOut: vi.fn(),
  }),
}))

vi.mock('sonner', () => ({ toast: state.toast }))

// The router's Link needs a router; a plain anchor with the resolved path is
// all these rows look at.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof Router>()),
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children?: React.ReactNode
  }) => (
    <a
      {...rest}
      href={to.replace(/\$(\w+)/g, (_, key: string) => params?.[key] ?? '')}
    >
      {children}
    </a>
  ),
}))

const { TournamentPublicPageContent } = await import('./tournament-public-page')

const tournamentId = 'tournament-1' as Id<'tournaments'>
const publicCode = '7K3M9Q'
const inviteCode = 'ABCDEFGHJK'
const capacity = 16

const feePreview = {
  entryFeeCents: 1500,
  platformFeeCents: 75,
  processingFeeCents: 77,
  totalCents: 1652,
  currency: 'usd',
}

type Lifecycle = Doc<'tournaments'>['lifecycle']
type Row = Pick<
  Doc<'tournamentRegistrations'>,
  'entryStatus' | 'participationStatus' | 'awaitingReview'
>
type Order = {
  status: string
  purpose: 'registration' | 'post_approval'
  cancelOutcome: 'full_refund' | 'entry_only_refund' | 'no_refund' | null
}
type Convention = {
  name: string
  publicCode: string
  myBadgeCompsThisEvent: boolean
}
type BadgeGate = 'missing' | 'wrong_day' | null

type Scenario = {
  lifecycle?: Lifecycle
  paid?: boolean
  approval?: boolean
  spotsLeft?: number
  viewer?: Gate
  registration?: Row | null | undefined
  order?: Order | null | undefined
  refundFlag?: { repeatDropFeesKept: boolean } | undefined
  feePreview?: 'loaded' | 'loading'
  convention?: Convention | null
  badgeGate?: BadgeGate
}

function tournament(scenario: Scenario): Doc<'tournaments'> {
  return {
    _id: tournamentId,
    _creationTime: 0,
    name: 'Store Championship',
    publicCode,
    organizationId: 'organization' as Id<'organizations'>,
    createdBy: 'user' as Id<'users'>,
    visibility: 'public',
    lifecycle: scenario.lifecycle ?? 'registration',
    startDate: 0,
    playerCapacity: capacity,
    format: 'standard',
    isTestEvent: false,
    autoPublishPairings: false,
    decklistRequired: false,
    registrationRequiresApproval: scenario.approval ?? false,
    entryFeeCents: scenario.paid ? 1500 : undefined,
    confirmedRegistrationCount: 0,
    seed: 1,
    updatedAt: 0,
  }
}

// A signed-in viewer with no row on an open, free event with room; each
// row overrides only what it is about. `in` keeps an explicit undefined
// (still loading) apart from "not given".
function setScenario(scenario: Scenario) {
  state.answers.event = {
    tournament: tournament(scenario),
    organizationName: null,
    registeredCount: capacity - (scenario.spotsLeft ?? 10),
    convention: scenario.convention ?? null,
    badgeGate: scenario.badgeGate ?? null,
  }
  state.answers.viewer = scenario.viewer ?? 'ready'
  state.answers.registration =
    'registration' in scenario ? scenario.registration : null
  state.answers.order = 'order' in scenario ? scenario.order : null
  state.answers.refundFlag =
    'refundFlag' in scenario
      ? scenario.refundFlag
      : { repeatDropFeesKept: false }
  state.answers.feePreview =
    scenario.feePreview === 'loading' ? undefined : feePreview
}

const confirmed = (participationStatus: Row['participationStatus']): Row => ({
  entryStatus: 'confirmed',
  participationStatus,
})
const pending = (awaitingReview?: true): Row => ({
  entryStatus: 'pending',
  awaitingReview,
})
const status = (entryStatus: Row['entryStatus']): Row => ({ entryStatus })
const order = (
  orderStatus: string,
  purpose: Order['purpose'],
  cancelOutcome: Order['cancelOutcome'] = null,
): Order => ({ status: orderStatus, purpose, cancelOutcome })

// The convention summary and the server's badge-gate verdict, as
// getPublicTournament ships them (model/conventions.ts childEventBadgeGate
// decides the verdict).
const summerCon: Convention = {
  name: 'Summer Con',
  publicCode: 'SUMCON',
  myBadgeCompsThisEvent: false,
}
const noBadge = { convention: summerCon, badgeGate: 'missing' } as const
const wrongDayBadge = { convention: summerCon, badgeGate: 'wrong_day' } as const
const admittingBadge = { convention: summerCon, badgeGate: null } as const
const compingBadge = {
  convention: { ...summerCon, myBadgeCompsThisEvent: true },
  badgeGate: null,
} as const
// A badge-gated parent the viewer may not open: no summary, still gated.
const hiddenNoBadge = { convention: null, badgeGate: 'missing' } as const
const hiddenWrongDay = { convention: null, badgeGate: 'wrong_day' } as const

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

function render(scenario: Scenario) {
  setScenario(scenario)
  act(() => {
    root.render(
      <TournamentPublicPageContent
        publicCode={publicCode}
        inviteCode={inviteCode}
      />,
    )
  })
}

const clean = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim()

function describeElement(element: Element): Array<string> {
  if (element.matches('[data-slot="separator"]')) return []
  const text = clean(element.textContent)
  if (element.matches('[data-slot="badge"]')) {
    return [`badge(${element.getAttribute('data-variant')}): ${text}`]
  }
  if (element instanceof HTMLAnchorElement) {
    return [`link(${element.getAttribute('href')}): ${text}`]
  }
  if (element instanceof HTMLButtonElement) {
    return [`button${element.disabled ? '(disabled)' : ''}: ${text}`]
  }
  if (element instanceof HTMLParagraphElement) {
    return [
      `note: ${text}`,
      ...Array.from(element.querySelectorAll('a')).flatMap(describeElement),
    ]
  }
  return Array.from(element.children).flatMap(describeElement)
}

// Everything below the event's details: the badge-gate notice, when there is
// one, and the registration panel.
function panel(): Array<string> {
  const grid = container.querySelector('article > div.grid')
  if (!grid) throw new Error('event details not rendered')
  return Array.from(grid.children).slice(1).flatMap(describeElement)
}

function button(label: string) {
  const match = Array.from(container.querySelectorAll('button')).find(
    (candidate) => clean(candidate.textContent) === label,
  )
  if (!match) throw new Error(`${label} button not found`)
  return match
}

async function click(label: string) {
  await act(async () => {
    button(label).click()
    await Promise.resolve()
  })
}

const checking = ['button(disabled): Checking your registration']
const closedNote = 'note: Registration is closed for this event.'
const lockedNote =
  'note: The event has started, so registration changes are locked.'
const spots = 'note: 10 spots left'
const cancel = 'button: Cancel registration'
const withdraw = 'button: Withdraw registration'
const playerView = `link(/tournaments/${publicCode}/play): Open my player view`
const followNote =
  'note: You can still follow standings and your match history.'
const registered = "badge(default): You're registered"
const dropped = 'badge(secondary): You dropped from this event'
const disqualified = 'badge(secondary): You were disqualified from this event'
const eliminated = "badge(secondary): You've been eliminated from this event"
const pendingBadge = 'badge(outline): Registration pending organizer approval'
const approvedBadge = 'badge(outline): Application approved — payment required'
const directDueBadge = 'badge(outline): Payment required to finish registering'
const waitlistBadge = "badge(outline): You're on the waitlist"
const missingBadgeNotice = [
  'note: This event requires a confirmed Summer Con badge — register for the convention first.',
  'link(/conventions/SUMCON): register for the convention',
]
const wrongDayNotice = [
  "note: Your Summer Con badge does not cover this event's date — upgrade your badge first.",
  'link(/conventions/SUMCON): upgrade your badge',
]
const hiddenMissingNotice =
  'note: This event requires a confirmed convention badge.'
const missingBadgeButton = 'button(disabled): Convention badge required'
const wrongDayButton = 'button(disabled): Your badge does not cover this date'
const fullRefundNote = 'note: Cancelling refunds your payment in full.'
const entryOnlyNote =
  'note: Cancelling refunds the entry cost only — fees are not refunded on a repeat drop.'
const noRefundNote =
  'note: The refund deadline has passed, so cancelling will not refund your payment.'

const rows: Array<[string, Scenario, Array<string>]> = [
  // The viewer.
  ['auth still settling', { viewer: 'pending' }, checking],
  [
    'an unverified viewer',
    { viewer: 'unverified' },
    [
      "note: You're signed in, but the server couldn't confirm your session. Try again, or sign out and sign back in.",
      'button: Try again',
      'button: Sign out',
    ],
  ],
  [
    'an unverified viewer after registration closed',
    { viewer: 'unverified', lifecycle: 'in_progress' },
    [
      "note: You're signed in, but the server couldn't confirm your session. Try again, or sign out and sign back in.",
      'button: Try again',
      'button: Sign out',
    ],
  ],
  [
    'signed out while registration is open',
    { viewer: 'signedOut' },
    ['button: Sign in to register', spots],
  ],
  [
    'signed out with one spot left',
    { viewer: 'signedOut', spotsLeft: 1 },
    ['button: Sign in to register', 'note: 1 spot left'],
  ],
  [
    'signed out on a full event',
    { viewer: 'signedOut', spotsLeft: 0 },
    ['button: Sign in to register', 'note: 0 spots left'],
  ],
  [
    'signed out on a badge-gated event',
    { viewer: 'signedOut', ...noBadge },
    [...missingBadgeNotice, 'button: Sign in to register', spots],
  ],
  [
    'signed out after registration closed',
    { viewer: 'signedOut', lifecycle: 'in_progress' },
    [closedNote],
  ],
  [
    'signed out on a completed event',
    { viewer: 'signedOut', lifecycle: 'completed' },
    [closedNote],
  ],
  ['the registration row loading', { registration: undefined }, checking],

  // A confirmed, active seat.
  [
    'active while registration is open',
    { registration: confirmed('active') },
    [registered, cancel],
  ],
  [
    'active on a paid event, refundable in full',
    {
      paid: true,
      registration: confirmed('active'),
      order: order('paid', 'registration', 'full_refund'),
    },
    [registered, cancel, fullRefundNote],
  ],
  [
    'active on a paid event, a repeat drop refunds the entry only',
    {
      paid: true,
      registration: confirmed('active'),
      order: order('paid', 'registration', 'entry_only_refund'),
    },
    [registered, cancel, entryOnlyNote],
  ],
  [
    'active on a paid event past the refund deadline',
    {
      paid: true,
      registration: confirmed('active'),
      order: order('paid', 'registration', 'no_refund'),
    },
    [registered, cancel, noRefundNote],
  ],
  [
    'active on a paid event while the order loads',
    { paid: true, registration: confirmed('active'), order: undefined },
    [registered, cancel],
  ],
  [
    'active on a comped paid event (no order)',
    {
      paid: true,
      registration: confirmed('active'),
      order: null,
      ...compingBadge,
    },
    [registered, cancel],
  ],
  [
    'active while the event runs',
    { registration: confirmed('active'), lifecycle: 'in_progress' },
    [registered, playerView],
  ],
  [
    'active on a paid event while it runs',
    {
      paid: true,
      registration: confirmed('active'),
      order: order('paid', 'registration', 'no_refund'),
      lifecycle: 'in_progress',
    },
    [registered, playerView],
  ],
  [
    'active after the event completed',
    { registration: confirmed('active'), lifecycle: 'completed' },
    [registered, lockedNote],
  ],
  [
    'active on a cancelled event',
    { registration: confirmed('active'), lifecycle: 'cancelled' },
    [registered, lockedNote],
  ],
  [
    'active on a full event',
    { registration: confirmed('active'), spotsLeft: 0 },
    [registered, cancel],
  ],
  [
    // The notice above the panel reads the badge alone.
    'active on a badge-gated event without a badge',
    { registration: confirmed('active'), ...noBadge },
    [...missingBadgeNotice, registered, cancel],
  ],

  // A confirmed seat out of contention.
  [
    'dropped while registration is open',
    { registration: confirmed('dropped') },
    [dropped, cancel],
  ],
  [
    'dropped on a paid event while registration is open',
    {
      paid: true,
      registration: confirmed('dropped'),
      order: order('paid', 'registration', 'full_refund'),
    },
    [dropped, cancel, fullRefundNote],
  ],
  [
    'dropped while the event runs',
    { registration: confirmed('dropped'), lifecycle: 'in_progress' },
    [dropped, playerView, followNote],
  ],
  [
    'dropped after the event completed',
    { registration: confirmed('dropped'), lifecycle: 'completed' },
    [dropped, lockedNote],
  ],
  [
    'disqualified while registration is open',
    { registration: confirmed('disqualified') },
    [disqualified, cancel],
  ],
  [
    'disqualified while the event runs',
    { registration: confirmed('disqualified'), lifecycle: 'in_progress' },
    [disqualified, playerView, followNote],
  ],
  [
    'disqualified after the event completed',
    { registration: confirmed('disqualified'), lifecycle: 'completed' },
    [disqualified, lockedNote],
  ],
  [
    // No cancel offer: elimination only happens in play.
    'eliminated while registration is open',
    { registration: confirmed('eliminated') },
    [eliminated, lockedNote],
  ],
  [
    'eliminated while the event runs',
    { registration: confirmed('eliminated'), lifecycle: 'in_progress' },
    [eliminated, playerView, followNote],
  ],
  [
    'eliminated after the event completed',
    { registration: confirmed('eliminated'), lifecycle: 'completed' },
    [eliminated, lockedNote],
  ],
  [
    // The schema leaves participationStatus optional; mutations set it on
    // every confirmation. The panel reads a missing one as active, as the
    // server's standings do; the server's cancel rule would refuse it.
    'confirmed with no participation status',
    { registration: { entryStatus: 'confirmed' } },
    [registered, cancel],
  ],

  // A pending entry.
  [
    'an application under review',
    { registration: pending(true), approval: true },
    [pendingBadge, withdraw],
  ],
  [
    'an application under review after registration closed',
    { registration: pending(true), approval: true, lifecycle: 'in_progress' },
    [pendingBadge, closedNote],
  ],
  [
    'an application under review on a paid event (no order yet)',
    {
      registration: pending(true),
      approval: true,
      paid: true,
      order: null,
    },
    [pendingBadge, withdraw],
  ],
  [
    'a pending entry on a paid event while the order loads',
    { registration: pending(), paid: true, order: undefined },
    checking,
  ],
  [
    'an approved application owing payment',
    {
      registration: pending(),
      approval: true,
      paid: true,
      order: order('requires_payment', 'post_approval'),
    },
    [approvedBadge, 'button: Complete payment — $16.52', withdraw],
  ],
  [
    'an approved application owing payment, fee preview loading',
    {
      registration: pending(),
      approval: true,
      paid: true,
      order: order('requires_payment', 'post_approval'),
      feePreview: 'loading',
    },
    [approvedBadge, 'button: Complete payment', withdraw],
  ],
  [
    'an approved application mid-checkout',
    {
      registration: pending(),
      approval: true,
      paid: true,
      order: order('awaiting_payment', 'post_approval'),
    },
    [approvedBadge, 'button: Complete payment — $16.52', withdraw],
  ],
  [
    'an unfinished direct checkout',
    {
      registration: pending(),
      paid: true,
      order: order('awaiting_payment', 'registration'),
    },
    [directDueBadge, 'button: Complete payment — $16.52', withdraw],
  ],
  [
    'an approved application owing payment after registration closed',
    {
      registration: pending(),
      approval: true,
      paid: true,
      order: order('requires_payment', 'post_approval'),
      lifecycle: 'in_progress',
    },
    [approvedBadge, closedNote],
  ],
  [
    'an unfinished direct checkout after registration closed',
    {
      registration: pending(),
      paid: true,
      order: order('awaiting_payment', 'registration'),
      lifecycle: 'in_progress',
    },
    [directDueBadge, closedNote],
  ],
  [
    // Checkout re-checks capacity before resuming a direct checkout.
    'an unfinished direct checkout on a full event',
    {
      registration: pending(),
      paid: true,
      order: order('awaiting_payment', 'registration'),
      spotsLeft: 0,
    },
    [directDueBadge, 'button(disabled): Tournament is full', withdraw],
  ],
  [
    // The approval already checked capacity, so Checkout doesn't.
    'an approved application owing payment on a full event',
    {
      registration: pending(),
      approval: true,
      paid: true,
      order: order('requires_payment', 'post_approval'),
      spotsLeft: 0,
    },
    [approvedBadge, 'button: Complete payment — $16.52', withdraw],
  ],
  [
    // Checkout refuses a comped viewer; registerSelf seats the entry free.
    'an approved application owing payment the badge now comps',
    {
      registration: pending(),
      approval: true,
      paid: true,
      order: order('requires_payment', 'post_approval'),
      ...compingBadge,
    },
    [
      'button: Register for this event',
      'note: 10 spots left · included with your convention badge',
    ],
  ],
  [
    'an unfinished direct checkout the badge now comps, on a full event',
    {
      registration: pending(),
      paid: true,
      order: order('awaiting_payment', 'registration'),
      ...compingBadge,
      spotsLeft: 0,
    },
    [directDueBadge, 'button(disabled): Tournament is full', withdraw],
  ],
  [
    'an approved application owing payment behind a wrong-day badge',
    {
      registration: pending(),
      approval: true,
      paid: true,
      order: order('requires_payment', 'post_approval'),
      ...wrongDayBadge,
    },
    [...wrongDayNotice, approvedBadge, wrongDayButton, withdraw],
  ],
  [
    'an unfinished direct checkout without a badge',
    {
      registration: pending(),
      paid: true,
      order: order('awaiting_payment', 'registration'),
      ...noBadge,
    },
    [...missingBadgeNotice, directDueBadge, missingBadgeButton, withdraw],
  ],
  [
    // The newest order belongs to an earlier attempt: a live application
    // under a refunded order is one real case (paymentsRefunds.convex.spec.ts).
    'a pending entry whose order can no longer be paid',
    {
      registration: pending(),
      paid: true,
      order: order('canceled', 'registration'),
    },
    [pendingBadge, withdraw],
  ],
  [
    'a pending entry whose order expired, after registration closed',
    {
      registration: pending(),
      paid: true,
      order: order('expired', 'registration'),
      lifecycle: 'in_progress',
    },
    [pendingBadge, closedNote],
  ],
  [
    'a pending entry on a full event',
    { registration: pending(true), approval: true, spotsLeft: 0 },
    [pendingBadge, withdraw],
  ],

  // Waitlisted and rejected.
  [
    'a waitlisted entry',
    { registration: status('waitlisted') },
    [waitlistBadge, withdraw],
  ],
  [
    'a waitlisted entry after registration closed',
    { registration: status('waitlisted'), lifecycle: 'in_progress' },
    [waitlistBadge, closedNote],
  ],
  [
    'a waitlisted entry on a paid event with a payable order',
    {
      registration: status('waitlisted'),
      paid: true,
      order: order('requires_payment', 'post_approval'),
    },
    [waitlistBadge, withdraw],
  ],
  [
    'a declined entry',
    { registration: status('rejected') },
    ['badge(destructive): Your registration was declined'],
  ],
  [
    'a declined entry after registration closed',
    { registration: status('rejected'), lifecycle: 'in_progress' },
    ['badge(destructive): Your registration was declined'],
  ],

  // No live entry.
  ['a free event', {}, ['button: Register for this event', spots]],
  [
    'a free event with one spot left',
    { spotsLeft: 1 },
    ['button: Register for this event', 'note: 1 spot left'],
  ],
  [
    'a cancelled row re-registers like a fresh one',
    { registration: status('cancelled') },
    ['button: Register for this event', spots],
  ],
  ['approval mode', { approval: true }, ['button: Request to register', spots]],
  [
    'a paid event',
    { paid: true },
    [
      'button: Register — $16.52',
      'note: 10 spots left · $15.00 entry + $1.52 fees',
    ],
  ],
  [
    'a paid event, fee preview loading',
    { paid: true, feePreview: 'loading' },
    ['button: Register for this event', spots],
  ],
  [
    'a paid event after an earlier full refund',
    { paid: true, refundFlag: { repeatDropFeesKept: true } },
    [
      'button: Register — $16.52',
      'note: 10 spots left · $15.00 entry + $1.52 fees',
      'note: You previously received a refund for this event — if you cancel again after paying, only the entry cost is refunded.',
    ],
  ],
  [
    'a paid event while the refund flag loads',
    { paid: true, refundFlag: undefined },
    [
      'button: Register — $16.52',
      'note: 10 spots left · $15.00 entry + $1.52 fees',
    ],
  ],
  [
    'a cancelled row on a paid event after an earlier full refund',
    {
      paid: true,
      registration: status('cancelled'),
      order: order('refunded', 'registration'),
      refundFlag: { repeatDropFeesKept: true },
    },
    [
      'button: Register — $16.52',
      'note: 10 spots left · $15.00 entry + $1.52 fees',
      'note: You previously received a refund for this event — if you cancel again after paying, only the entry cost is refunded.',
    ],
  ],
  [
    'a paid event in approval mode',
    { paid: true, approval: true },
    [
      'button: Request to register',
      'note: 10 spots left · $16.52 due after approval',
    ],
  ],
  [
    'a paid event in approval mode, fee preview loading',
    { paid: true, approval: true, feePreview: 'loading' },
    ['button: Request to register', spots],
  ],
  [
    'a paid event in approval mode after an earlier full refund',
    { paid: true, approval: true, refundFlag: { repeatDropFeesKept: true } },
    [
      'button: Request to register',
      'note: 10 spots left · $16.52 due after approval',
    ],
  ],
  [
    'a paid event the badge comps',
    { paid: true, ...compingBadge },
    [
      'button: Register for this event',
      'note: 10 spots left · included with your convention badge',
    ],
  ],
  [
    'a paid event in approval mode the badge comps',
    { paid: true, approval: true, ...compingBadge },
    [
      'button: Request to register',
      'note: 10 spots left · included with your convention badge',
    ],
  ],
  [
    'a free event the badge would comp',
    { ...compingBadge },
    ['button: Register for this event', spots],
  ],
  [
    'a badge-gated event the badge admits',
    { ...admittingBadge },
    ['button: Register for this event', spots],
  ],
  ['registration closed', { lifecycle: 'in_progress' }, [closedNote]],
  ['a completed event', { lifecycle: 'completed' }, [closedNote]],
  ['a cancelled event', { lifecycle: 'cancelled' }, [closedNote]],
  ['a full event', { spotsLeft: 0 }, ['button(disabled): Tournament is full']],
  [
    'a full event in approval mode',
    { spotsLeft: 0, approval: true },
    ['button(disabled): Tournament is full'],
  ],
  [
    'a full paid event the badge comps',
    { spotsLeft: 0, paid: true, ...compingBadge },
    ['button(disabled): Tournament is full'],
  ],
  [
    'a full badge-gated event without a badge',
    { spotsLeft: 0, ...noBadge },
    [...missingBadgeNotice, 'button(disabled): Tournament is full'],
  ],
  [
    'a badge-gated event without a badge',
    { ...noBadge },
    [...missingBadgeNotice, missingBadgeButton, spots],
  ],
  [
    'a badge-gated event with a wrong-day badge',
    { ...wrongDayBadge },
    [...wrongDayNotice, wrongDayButton, spots],
  ],
  [
    'a badge-gated paid event without a badge',
    { paid: true, ...noBadge },
    [...missingBadgeNotice, missingBadgeButton, spots],
  ],
  [
    'a hidden badge-gated parent',
    { ...hiddenNoBadge },
    [hiddenMissingNotice, missingBadgeButton, spots],
  ],
  [
    'a hidden badge-gated parent, signed out',
    { viewer: 'signedOut', ...hiddenNoBadge },
    [hiddenMissingNotice, 'button: Sign in to register', spots],
  ],
  [
    'a hidden badge-gated parent with a wrong-day badge',
    { ...hiddenWrongDay },
    [
      "note: Your convention badge does not cover this event's date.",
      wrongDayButton,
      spots,
    ],
  ],
  [
    'an unfinished direct checkout behind a hidden badge-gated parent',
    {
      registration: pending(),
      paid: true,
      order: order('awaiting_payment', 'registration'),
      ...hiddenNoBadge,
    },
    [hiddenMissingNotice, directDueBadge, missingBadgeButton, withdraw],
  ],
  [
    'a badge-gated event after registration closed',
    { ...noBadge, lifecycle: 'in_progress' },
    [closedNote],
  ],
]

describe('RegistrationPanel', () => {
  test.each(rows)('%s', (_name, scenario, expected) => {
    render(scenario)
    expect(panel()).toEqual(expected)
  })
})

// A private event answers null to a viewer it doesn't admit, so a signed-out
// null is not known to be a missing event: the page offers sign-in, which
// returns here (refreshAuth). A null for a signed-in viewer is final.
describe('an event the lookup answers null', () => {
  function renderNull(viewer: Gate) {
    setScenario({ viewer })
    state.answers.event = null
    act(() => {
      root.render(
        <TournamentPublicPageContent
          publicCode={publicCode}
          inviteCode={inviteCode}
        />,
      )
    })
  }
  const text = () => clean(container.textContent)

  test('a signed-out viewer is offered sign-in', async () => {
    renderNull('signedOut')
    expect(text()).toContain('Sign in to view this event')
    expect(text()).not.toContain('Tournament not found')
    await click('Sign in')
    expect(state.refreshAuth).toHaveBeenCalledWith({ ensureSignedIn: true })
  })

  test('a signed-in viewer is told it was not found', () => {
    renderNull('ready')
    expect(text()).toContain('Tournament not found')
    expect(text()).not.toContain('Sign in')
  })

  // The null may still turn into the event once Convex verifies the viewer.
  test('waits while the auth gate settles', () => {
    renderNull('pending')
    expect(text()).toContain('Loading tournament')
  })
})

describe('RegistrationPanel actions', () => {
  test('signing in asks for a sign-in', async () => {
    render({ viewer: 'signedOut' })
    await click('Sign in to register')
    expect(state.refreshAuth).toHaveBeenCalledWith({ ensureSignedIn: true })
  })

  test('a free registration calls registerSelf with the invite code', async () => {
    state.registerSelf.mockResolvedValue('registration-1')
    render({})
    await click('Register for this event')
    expect(state.registerSelf).toHaveBeenCalledWith({
      tournamentId,
      inviteCode,
    })
    expect(state.toast.success).toHaveBeenCalledWith(
      "You're registered. See you at the event!",
    )
    expect(state.createEntryCheckout).not.toHaveBeenCalled()
  })

  test('an application calls registerSelf and says it awaits approval', async () => {
    state.registerSelf.mockResolvedValue('registration-1')
    render({ approval: true, paid: true })
    await click('Request to register')
    expect(state.registerSelf).toHaveBeenCalledWith({
      tournamentId,
      inviteCode,
    })
    expect(state.toast.success).toHaveBeenCalledWith(
      'Registration submitted for organizer approval.',
    )
  })

  test('a comped viewer registers directly, never through Checkout', async () => {
    state.registerSelf.mockResolvedValue('registration-1')
    render({ paid: true, ...compingBadge })
    await click('Register for this event')
    expect(state.registerSelf).toHaveBeenCalledWith({
      tournamentId,
      inviteCode,
    })
    expect(state.createEntryCheckout).not.toHaveBeenCalled()
  })

  test('an entry owing payment the badge now comps registers through registerSelf', async () => {
    state.registerSelf.mockResolvedValue('registration-1')
    render({
      registration: pending(),
      approval: true,
      paid: true,
      order: order('requires_payment', 'post_approval'),
      ...compingBadge,
    })
    await click('Register for this event')
    expect(state.registerSelf).toHaveBeenCalledWith({
      tournamentId,
      inviteCode,
    })
    expect(state.toast.success).toHaveBeenCalledWith(
      "You're registered. See you at the event!",
    )
    expect(state.createEntryCheckout).not.toHaveBeenCalled()
  })

  test('a failed registration toasts the error', async () => {
    state.registerSelf.mockRejectedValue(new Error('boom'))
    render({})
    await click('Register for this event')
    expect(state.toast.error).toHaveBeenCalled()
    expect(state.toast.success).not.toHaveBeenCalled()
  })

  test('a paid registration opens Checkout', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    state.createEntryCheckout.mockResolvedValue({
      kind: 'checkout',
      url: 'https://checkout.stripe.test/session',
    })
    render({ paid: true })
    await click('Register — $16.52')
    expect(state.createEntryCheckout).toHaveBeenCalledWith({
      tournamentId,
      inviteCode,
    })
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/session')
    expect(state.registerSelf).not.toHaveBeenCalled()
  })

  test('a Checkout that finds an enrolled seat says there is nothing to pay', async () => {
    state.createEntryCheckout.mockResolvedValue({ kind: 'registered' })
    render({ paid: true })
    await click('Register — $16.52')
    expect(state.toast.success).toHaveBeenCalledWith(
      "You're already registered for this event — there's nothing to pay.",
    )
    expect(button('Register — $16.52').disabled).toBe(false)
  })

  test('a failed Checkout toasts the error and re-enables the button', async () => {
    state.createEntryCheckout.mockRejectedValue(new Error('boom'))
    render({ paid: true })
    await click('Register — $16.52')
    expect(state.toast.error).toHaveBeenCalledWith('boom')
    expect(button('Register — $16.52').disabled).toBe(false)
  })

  test('completing payment opens Checkout for the pending entry', async () => {
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    state.createEntryCheckout.mockResolvedValue({
      kind: 'checkout',
      url: 'https://checkout.stripe.test/session',
    })
    render({
      registration: pending(),
      approval: true,
      paid: true,
      order: order('requires_payment', 'post_approval'),
    })
    await click('Complete payment — $16.52')
    expect(state.createEntryCheckout).toHaveBeenCalledWith({
      tournamentId,
      inviteCode,
    })
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.test/session')
  })

  test('cancelling a seat calls cancelMyRegistration', async () => {
    state.cancelMyRegistration.mockResolvedValue(null)
    render({ registration: confirmed('active') })
    await click('Cancel registration')
    expect(state.cancelMyRegistration).toHaveBeenCalledWith({ tournamentId })
    expect(state.toast.success).toHaveBeenCalledWith(
      'Your registration has been cancelled.',
    )
  })

  test('a dropped player cancels the same way', async () => {
    state.cancelMyRegistration.mockResolvedValue(null)
    render({ registration: confirmed('dropped') })
    await click('Cancel registration')
    expect(state.cancelMyRegistration).toHaveBeenCalledWith({ tournamentId })
    expect(state.toast.success).toHaveBeenCalledWith(
      'Your registration has been cancelled.',
    )
  })

  test.each<[string, Scenario]>([
    ['an application', { registration: pending(true), approval: true }],
    ['a waitlisted entry', { registration: status('waitlisted') }],
    [
      'an entry owing payment',
      {
        registration: pending(),
        paid: true,
        order: order('awaiting_payment', 'registration'),
      },
    ],
    [
      'an entry owing payment behind the badge gate',
      {
        registration: pending(),
        paid: true,
        order: order('awaiting_payment', 'registration'),
        ...noBadge,
      },
    ],
  ])('withdrawing %s calls cancelMyRegistration', async (_name, scenario) => {
    state.cancelMyRegistration.mockResolvedValue(null)
    render(scenario)
    await click('Withdraw registration')
    expect(state.cancelMyRegistration).toHaveBeenCalledWith({ tournamentId })
    expect(state.toast.success).toHaveBeenCalledWith(
      'Your registration has been withdrawn.',
    )
  })

  test('an unverified viewer can restart the Convex handshake', async () => {
    render({ viewer: 'unverified' })
    await click('Try again')
    expect(state.restartAuth).toHaveBeenCalled()
  })
})
