import { displayPlayerName, formatGameScoreline } from '@paper-pairings/core'
import { formatTimer } from '@paper-pairings/shared/timer-utils'

import type { FunctionReturnType } from 'convex/server'
import type { api } from '@paper-pairings/backend/convex/_generated/api'
import { formatCents } from '@/lib/money'

export type AuditEventRow = FunctionReturnType<
  typeof api.tournaments.auditLog.listAuditEvents
>['page'][number]

type ResultLine = Extract<
  AuditEventRow['event'],
  { type: 'match_result_reported' }
>['result'][number]

// One sentence per audit event, shared by the Activity tab and the overview's
// recent-activity list so the same event never reads two ways.
export function describeAuditEvent(row: AuditEventRow): string {
  const { event } = row
  switch (event.type) {
    case 'match_result_recorded':
      return `Recorded ${formatAuditScoreline(event.result)} ${matchLocation(event)}`
    case 'match_result_reported':
      return `Reported ${formatAuditScoreline(event.result)} ${matchLocation(event)}`
    case 'match_conceded':
      return `${displayPlayerName(event.player.playerName)} conceded by dropping: ${formatAuditScoreline(event.result)} ${matchLocation(event)}`
    case 'player_registered':
      return `${displayPlayerName(event.player.playerName)} registered for the event${compedSuffix(event)}`
    case 'registration_requested':
      return `${displayPlayerName(event.player.playerName)} requested to register for the event`
    case 'player_enrolled':
      // By email the label is the address the organizer typed (this log is
      // organizer-only), named as such rather than passed off as a name.
      return event.by === 'name'
        ? `Added ${displayPlayerName(event.player.playerName)} as a guest`
        : `Enrolled ${event.player.playerName ?? 'a player'} by email; awaiting player details`
    case 'player_named':
      return event.previousLabel
        ? `Named ${displayPlayerName(event.player.playerName)} for this event (was ${event.previousLabel})`
        : `Named ${displayPlayerName(event.player.playerName)} for this event`
    case 'decklist_submitted':
      return `${displayPlayerName(event.player.playerName)} ${event.isUpdate ? 'updated' : 'submitted'} their decklist (${event.maindeckCardCount} main / ${event.sideboardCardCount} sideboard)`
    case 'registration_cancelled':
      return row.actorRole === 'organizer'
        ? `Cancelled ${displayPlayerName(event.player.playerName)}'s registration`
        : `${displayPlayerName(event.player.playerName)} cancelled their registration`
    case 'registration_approved':
      // previousEntryStatus says which decision the approval was — see the
      // audit event validator.
      return (
        (event.previousEntryStatus === 'waitlisted'
          ? `Promoted ${displayPlayerName(event.player.playerName)} from the waitlist`
          : event.previousEntryStatus === 'rejected'
            ? `Reversed ${displayPlayerName(event.player.playerName)}'s rejection and confirmed their registration`
            : `Approved ${displayPlayerName(event.player.playerName)}'s registration`) +
        compedSuffix(event)
      )
    case 'registration_rejected':
      return event.previousEntryStatus === 'confirmed'
        ? `Removed ${displayPlayerName(event.player.playerName)} from the event and barred re-entry`
        : event.previousEntryStatus === 'cancelled'
          ? `Barred ${displayPlayerName(event.player.playerName)} from re-entering the event`
          : `Declined ${displayPlayerName(event.player.playerName)}'s registration`
    case 'registration_waitlisted':
      return `Moved ${displayPlayerName(event.player.playerName)}'s registration to the waitlist`
    case 'player_dropped':
      return row.actorRole === 'organizer'
        ? `Dropped ${displayPlayerName(event.player.playerName)} from the event`
        : `${displayPlayerName(event.player.playerName)} dropped from the event`
    case 'player_reinstated':
      return `Reinstated ${displayPlayerName(event.player.playerName)}${compedSuffix(event)}`
    case 'tournament_published':
      return 'Published the tournament and opened registration'
    case 'player_meeting_started':
      return `Started the phase ${event.phaseOrder} player meeting with ${event.playerCount} players seated`
    case 'tournament_started':
      return `Started the tournament with ${event.playerCount} players and paired round 1`
    case 'round_started':
      return `Paired round ${event.roundNumber} with ${event.playerCount} players`
    case 'pairings_published':
      return `Published round ${event.roundNumber} pairings to players`
    case 'round_duration_changed':
      return event.previousDurationMs === null
        ? `Set the default round length to ${formatTimer(event.durationMs)}`
        : `Changed the default round length from ${formatTimer(event.previousDurationMs)} to ${formatTimer(event.durationMs)}`
    case 'round_timer_changed':
      return describeTimerChange(event)
    case 'pairing_broken':
      return event.wasBye
        ? `Broke ${displayPlayerName(event.players.at(0)?.playerName)}'s bye ${matchLocation({ roundNumber: event.roundNumber, tableNumber: event.tableNumber })}`
        : `Broke the ${formatPairingPlayers(event.players)} pairing ${matchLocation({ roundNumber: event.roundNumber, tableNumber: event.tableNumber })}`
    case 'pairing_created':
      return event.isBye
        ? `Awarded ${displayPlayerName(event.players.at(0)?.playerName)} a bye ${matchLocation({ roundNumber: event.roundNumber, tableNumber: event.tableNumber })}`
        : `Paired ${formatPairingPlayers(event.players)} ${matchLocation({ roundNumber: event.roundNumber, tableNumber: event.tableNumber })}`
    case 'round_completed':
      return `Completed round ${event.roundNumber} and posted standings`
    case 'round_rewound':
      return event.reopenedRoundNumber === null
        ? `Unpublished round ${event.removedRoundNumber} pairings and reopened registration`
        : `Unpublished round ${event.removedRoundNumber} pairings and reopened round ${event.reopenedRoundNumber}`
    case 'tournament_completed':
      return 'Completed the tournament'
    case 'tournament_cancelled':
      return 'Cancelled the tournament'
    case 'payment_completed':
      return `${displayPlayerName(event.player.playerName)}'s entry payment of ${formatCents(event.totalCents)} completed`
    case 'payment_failed':
      return `${displayPlayerName(event.player.playerName)}'s entry payment failed`
    case 'payment_expired':
      return `${displayPlayerName(event.player.playerName)}'s checkout expired unpaid`
    case 'payment_requested':
      return `Approved ${displayPlayerName(event.player.playerName)}'s application and requested the ${formatCents(event.totalCents)} entry payment`
    case 'refund_issued':
      return `Refunded ${formatCents(event.amountCents)} to ${displayPlayerName(event.player.playerName)} (${describeRefundReason(event.reason)}${event.kind === 'entry_only' ? ', entry cost only' : ''})`
    case 'refund_stalled':
      return `Refund of ${formatCents(event.amountCents)} to ${displayPlayerName(event.player.playerName)} could not be confirmed — check its status from the payout settings`
    case 'refund_failed':
      return `Refund of ${formatCents(event.amountCents)} to ${displayPlayerName(event.player.playerName)} failed — Stripe returned nothing`
    case 'payout_sent':
      return `Paid out ${formatCents(event.netCents)} in entry fees to the organization`
    case 'payout_failed':
      return 'The entry-fee payout failed — needs attention'
    case 'order_disputed':
      return `${displayPlayerName(event.player.playerName)}'s entry payment was disputed — excluded from the payout`
  }
}

function describeRefundReason(
  reason:
    | 'player_cancel'
    | 'organizer_remove'
    | 'tournament_cancelled'
    | 'convention_cancelled'
    | 'seat_unavailable',
) {
  switch (reason) {
    case 'player_cancel':
      return 'player unregistered'
    case 'organizer_remove':
      return 'removed by organizer'
    case 'tournament_cancelled':
      return 'tournament cancelled'
    // Never emitted into a tournament's log (the reason belongs to badge
    // refunds), but the shared validator admits it, so describe it honestly.
    case 'convention_cancelled':
      return 'convention cancelled'
    case 'seat_unavailable':
      return 'no seat available'
  }
}

type TimerChange = Extract<
  AuditEventRow['event'],
  { type: 'round_timer_changed' }
>

// The control and, where it says something, the timer it left behind: the
// length a start set, the time a pause froze, the time an adjustment moved.
function describeTimerChange({ operation, previousTimer, timer }: TimerChange) {
  switch (operation) {
    case 'started':
      return `${previousTimer ? 'Restarted' : 'Started'} the round timer${timer ? ` (${formatTimer(timer.durationMs)})` : ''}`
    case 'paused':
      if (timer?.kind !== 'paused') {
        return 'Paused the round timer'
      }
      return timer.remainingMs < 0
        ? `Paused the round timer in overtime (${formatTimer(timer.remainingMs)})`
        : `Paused the round timer with ${formatTimer(timer.remainingMs)} left`
    case 'resumed':
      return 'Resumed the round timer'
    case 'adjusted': {
      const deltaMs = timerShiftMs(previousTimer, timer)
      return deltaMs === 0
        ? 'Adjusted the round timer'
        : `${deltaMs > 0 ? 'Added' : 'Took'} ${formatTimer(Math.abs(deltaMs))} ${deltaMs > 0 ? 'to' : 'off'} the round timer`
    }
    case 'cleared':
      return 'Cleared the round timer'
  }
}

// How far an adjustment moved the clock, read off the anchor it shifted
// (endsAt while running, remainingMs while paused).
function timerShiftMs(
  before: TimerChange['previousTimer'],
  after: TimerChange['timer'],
) {
  if (before?.kind === 'running' && after?.kind === 'running') {
    return after.endsAt - before.endsAt
  }
  if (before?.kind === 'paused' && after?.kind === 'paused') {
    return after.remainingMs - before.remainingMs
  }
  return 0
}

// The comped-entry marker on admission events: a paid event seated this
// player free because their convention pass comps it (ADR 0004).
function compedSuffix(event: { compedByBadge?: boolean }) {
  return event.compedByBadge ? ' — comped by their convention badge' : ''
}

function formatPairingPlayers(players: Array<{ playerName: string | null }>) {
  return players
    .map((player) => displayPlayerName(player.playerName))
    .join(' vs. ')
}

function matchLocation(event: {
  roundNumber: number
  tableNumber: number | null
}) {
  return event.tableNumber === null
    ? `(round ${event.roundNumber})`
    : `(round ${event.roundNumber}, table ${event.tableNumber})`
}

export function formatAuditScoreline(lines: Array<ResultLine>) {
  const first = lines.at(0)
  const second = lines.at(1)
  if (!first || !second) {
    return 'a match result'
  }
  const scoreline = formatGameScoreline(
    first.gameWins,
    second.gameWins,
    first.gameDraws,
  )
  return `${displayPlayerName(first.playerName)} ${scoreline} ${displayPlayerName(second.playerName)}`
}

export function formatAuditTimestamp(creationTime: number) {
  return new Date(creationTime).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}
