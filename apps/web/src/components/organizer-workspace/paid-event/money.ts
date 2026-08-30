// Dollars/cents input helpers for the paid-event settings cards. Display
// formatting lives in @/lib/money.

// Dollars string for the input from stored cents, and back. An empty input
// means "free event" and clears the fee server-side (entryFeeCents: 0).
export function toDollarsValue(cents: number | undefined) {
  return cents === undefined ? '' : (cents / 100).toFixed(2)
}

export function parseDollarsToCents(value: string) {
  if (value.trim() === '') {
    return 0
  }
  const dollars = Number.parseFloat(value)
  if (!Number.isFinite(dollars)) {
    return Number.NaN
  }
  return Math.round(dollars * 100)
}
