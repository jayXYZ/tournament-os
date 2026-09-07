import { useSyncExternalStore } from 'react'
import { getFunctionName } from 'convex/server'
import type { FunctionReference } from 'convex/server'

export const scenario = new URLSearchParams(location.search).get('scenario')
let auth = scenario === 'badge' ? 'pending' : 'signedOut'
let registered = false
let revision = 0
const listeners = new Set<() => void>()
export const calls: Array<{ name: string; args: Record<string, unknown> }> = []
function changed() {
  revision++
  listeners.forEach((listener) => listener())
}
export function useFixture() {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => revision,
  )
}
export function finishSignIn() {
  auth = 'ready'
  changed()
}

const tournament = {
  _id: 'tournament',
  _creationTime: 0,
  publicCode: 100001,
  name: 'Smoke Cup',
  organizationId: 'organization',
  createdBy: 'organizer',
  lifecycle: scenario === 'organizer' ? 'setup' : 'registration',
  visibility: 'public',
  startDate: Date.UTC(2027, 0, 1),
  playerCapacity: 16,
  confirmedRegistrationCount: 4,
  format: 'standard',
  isTestEvent: true,
  autoPublishPairings: false,
  updatedAt: 0,
}
const convention = {
  ...tournament,
  _id: 'convention',
  name: 'Smoke Convention',
  endDate: Date.UTC(2027, 0, 3),
  badgeRequiredForChildEvents: false,
}
const phase = {
  _id: 'phase',
  _creationTime: 0,
  tournamentId: 'tournament',
  phaseOrder: 1,
  phaseType: 'swiss',
  phaseStatus: 'upcoming',
  phaseTotalRounds: 1,
  phaseRoundMode: 'fixed',
  bestOf: 3,
  updatedAt: 0,
}
const rounds: Array<Record<string, unknown>> = []
let nextStep: Record<string, unknown> = {
  kind: 'publishTournament',
  ready: true,
  reason: null,
}

export function useConvexAuth() {
  useFixture()
  return { isLoading: auth === 'pending', isAuthenticated: auth === 'ready' }
}
export function useAppAuth() {
  useFixture()
  return {
    user: auth === 'signedOut' ? null : { email: 'player@example.test' },
    loading: false,
    refreshAuth: () => {
      auth = 'pending'
      changed()
    },
    signOut: () => {
      auth = 'signedOut'
      changed()
    },
  }
}
export function useQuery(
  query: FunctionReference<'query'>,
  args: Record<string, unknown> | 'skip' = {},
) {
  useFixture()
  if (args === 'skip') return undefined
  switch (getFunctionName(query)) {
    case 'tournaments/lifecycle:getPublicTournament':
      return {
        tournament,
        convention: null,
        organizationName: 'Smoke Org',
        registeredCount: registered ? 5 : 4,
      }
    case 'conventions/lifecycle:getPublicConvention':
      return { convention, organizationName: 'Smoke Org', registeredCount: 4 }
    case 'tournaments/registrations:getMyRegistration':
      return auth === 'ready' && registered
        ? { entryStatus: 'confirmed', participationStatus: 'active' }
        : null
    case 'conventions/registrations:getMyBadge':
      return auth === 'ready'
        ? { entryStatus: 'confirmed', ticketTypeId: 'ticket' }
        : null
    case 'payments/queries:getMyEntryOrder':
    case 'payments/queries:getMyBadgeOrder':
      return null
    case 'payments/queries:getMyRefundFlag':
    case 'payments/queries:getMyBadgeRefundFlag':
      return { repeatDropFeesKept: false }
    case 'conventions/ticketTypes:listPublicTicketTypes':
      return [
        {
          ticketTypeId: 'ticket',
          name: 'General admission',
          priceCents: 0,
          totalWithFeesCents: null,
          admissionStartDate: null,
          admissionEndDate: null,
          onSale: true,
          soldOut: false,
          refreshAt: null,
        },
      ]
    case 'tournaments/rounds:getPairingsBoard':
      return {
        tournament,
        phases: [
          {
            phase,
            rounds,
            timeline: { startRoundNumber: 1, plannedRoundCount: 1 },
          },
        ],
        nextStep,
        rewind: { allowed: false, reason: 'Unavailable' },
      }
    default:
      throw new Error(`Unconfigured smoke query: ${getFunctionName(query)}`)
  }
}
export function usePaginatedQuery(query: FunctionReference<'query'>) {
  useFixture()
  if (getFunctionName(query) !== 'conventions/events:listPublicChildEvents')
    throw new Error('Unexpected paginated query')
  return { results: [], status: 'Exhausted', loadMore: () => {} }
}
export function useMutation(mutation: FunctionReference<'mutation'>) {
  return (args: Record<string, unknown>) => {
    const name = getFunctionName(mutation)
    calls.push({ name, args })
    switch (name) {
      case 'tournaments/registrations:registerSelf':
        registered = true
        break
      case 'tournaments/registrations:cancelMyRegistration':
        registered = false
        break
      case 'tournaments/lifecycle:publishTournament':
        tournament.lifecycle = 'registration'
        nextStep = { kind: 'startTournament', ready: true, reason: null }
        break
      case 'tournaments/rounds:startTournament':
        tournament.lifecycle = 'in_progress'
        phase.phaseStatus = 'in_progress'
        rounds.push({
          _id: 'round',
          roundNumber: 1,
          roundName: 'Round 1',
          roundStatus: 'in_progress',
        })
        nextStep = {
          kind: 'publishPairings',
          roundId: 'round',
          ready: true,
          reason: null,
        }
        break
      case 'tournaments/rounds:publishPairings':
        rounds[0].pairingsPublishedAt = Date.now()
        nextStep = { kind: 'startTimer', ready: true, reason: null }
        break
      default:
        throw new Error(`Unconfigured smoke mutation: ${name}`)
    }
    changed()
    return Promise.resolve('ok')
  }
}
export function useAction() {
  return () =>
    Promise.reject(
      new Error('External actions are not part of the isolated smoke suite'),
    )
}
