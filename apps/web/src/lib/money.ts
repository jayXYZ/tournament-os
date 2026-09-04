// The one currency formatter: public pages, audit logs, and the paid-event
// settings cards all render stored cents through it.
export function formatCents(cents: number) {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}
