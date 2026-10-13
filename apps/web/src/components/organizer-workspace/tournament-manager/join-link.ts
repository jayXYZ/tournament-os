import type { Doc } from '@paper-pairings/backend/convex/_generated/dataModel'
import { formatCents } from '@/lib/money'

// The /join URL an organizer shares or prints (CONTEXT.md "Join QR"). The
// code is the event's public code, or for a private event its invite code;
// the join route tells the two apart by length.
export function joinPath(code: string) {
  return `/join/${code}`
}

// The full URL is built from whichever deployment the organizer has open.
// SSR has no window, but every caller renders from a client-side query, so
// the path-only fallback never reaches the screen in practice.
export function joinUrl(code: string) {
  return typeof window === 'undefined'
    ? joinPath(code)
    : `${window.location.origin}${joinPath(code)}`
}

// How an invite code reads when typed by hand: two groups of five. The
// server ignores the dash. A public code is short enough to print as is.
export function formatInviteCode(code: string) {
  return `${code.slice(0, 5)}-${code.slice(5)}`
}

// The line under a join QR code, telling a passer-by what scanning does.
export function joinQrCaption(
  tournament: Pick<
    Doc<'tournaments'>,
    'registrationRequiresApproval' | 'entryFeeCents'
  >,
) {
  if (tournament.registrationRequiresApproval) {
    return 'Scan to request a spot'
  }
  if (tournament.entryFeeCents !== undefined) {
    return `Scan to register — ${formatCents(tournament.entryFeeCents)} entry`
  }
  return 'Scan to join'
}
