// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, test, vi } from 'vitest'
import {
  PaidEventPayoutCard,
  REFUNDS_NEEDING_ATTENTION_PAGE_SIZE,
} from './payout-card'
import type { RefundsNeedingAttention } from './payout-card'

const workspace = vi.hoisted(() => ({ role: 'owner' }))

vi.mock('@/components/organizer-workspace/organization-context', () => ({
  useOrganization: () => ({
    selectedOrganizationId: 'organization-a',
    selectedOrganization: {
      organization: {
        _id: 'organization-a',
        name: 'Organization A',
        profileImageUrl: null,
      },
      membership: { role: workspace.role },
    },
    clearSelectedOrganization: vi.fn(),
  }),
}))

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}))

type Refund = RefundsNeedingAttention['results'][number]

function refund(index: number, status: Refund['status']): Refund {
  return {
    refundId: `refund-${status}-${index}` as Refund['refundId'],
    status,
    playerName: `Player ${index}`,
    amountCents: 2194,
    attemptCount: status === 'needs_attention' ? 5 : 1,
    lastError: status === 'needs_attention' ? 'socket hang up' : null,
    updatedAt: 0,
  }
}

function list(
  results: Array<Refund>,
  status: RefundsNeedingAttention['status'],
  loadMore = vi.fn(),
): RefundsNeedingAttention {
  return {
    results,
    status,
    isLoading: status === 'LoadingFirstPage' || status === 'LoadingMore',
    loadMore,
  } as RefundsNeedingAttention
}

const copy = {
  title: 'Entry fee payout',
  description: 'Entry fees transfer when the tournament completes.',
  pendingMessage:
    'The payout runs automatically once the tournament is completed.',
  feesLabel: 'entry fees',
}

function buttons(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll('button')).filter(
    (button) => button.textContent === label,
  )
}

test('each refund list pages on its own, and a processing refund is checkable behind a page of parked ones', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  workspace.role = 'owner'
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const loadMoreUnresolved = vi.fn()
  const loadMoreProcessing = vi.fn()
  const onCheckRefund = vi
    .fn()
    .mockResolvedValue({ result: 'settled', status: 'succeeded' })

  const parked = Array.from(
    { length: REFUNDS_NEEDING_ATTENTION_PAGE_SIZE },
    (_, index) => refund(index, 'needs_attention'),
  )
  const processing = [refund(99, 'pending')]

  try {
    // The tournament has not completed: the lists still show, with their
    // checks, since a parked refund needs the owner before the payout.
    await act(() =>
      root.render(
        <PaidEventPayoutCard
          isPaid
          completed={false}
          payout={undefined}
          unresolvedRefunds={list(parked, 'CanLoadMore', loadMoreUnresolved)}
          processingRefunds={list(processing, 'Exhausted', loadMoreProcessing)}
          onRetry={() => Promise.resolve()}
          onCheckRefund={onCheckRefund}
          copy={copy}
        />,
      ),
    )
    expect(buttons(container, 'Check refund status')).toHaveLength(
      REFUNDS_NEEDING_ATTENTION_PAGE_SIZE + 1,
    )
    expect(container.textContent).toContain('Stripe is still processing the')

    // Only the list with more pages offers to load them, and it asks for
    // one more page of its own.
    expect(buttons(container, 'Load more processing refunds')).toHaveLength(0)
    const [loadMore] = buttons(container, 'Load more unresolved refunds')
    expect(loadMore).toBeDefined()
    await act(() => loadMore.click())
    expect(loadMoreUnresolved).toHaveBeenCalledWith(
      REFUNDS_NEEDING_ATTENTION_PAGE_SIZE,
    )
    expect(loadMoreProcessing).not.toHaveBeenCalled()

    // The processing refund's check runs without any parked row settling.
    const checks = buttons(container, 'Check refund status')
    await act(() => checks[checks.length - 1].click())
    expect(onCheckRefund).toHaveBeenCalledTimes(1)
    expect(onCheckRefund).toHaveBeenCalledWith(processing[0].refundId)

    // A member without the payments permission sees the rows but cannot
    // check them.
    workspace.role = 'organizer'
    await act(() =>
      root.render(
        <PaidEventPayoutCard
          isPaid
          completed={false}
          payout={undefined}
          unresolvedRefunds={list(parked, 'CanLoadMore', loadMoreUnresolved)}
          processingRefunds={list(processing, 'Exhausted', loadMoreProcessing)}
          onRetry={() => Promise.resolve()}
          onCheckRefund={onCheckRefund}
          copy={copy}
        />,
      ),
    )
    expect(
      buttons(container, 'Check refund status').every(
        (button) => button.disabled,
      ),
    ).toBe(true)
    expect(container.textContent).toContain(
      "Only the organization owner can check a refund's status.",
    )
  } finally {
    await act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
