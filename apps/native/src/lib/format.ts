// Native twins of the web's formatters, so an event reads the same on both
// clients: formatCents mirrors apps/web/src/lib/money.ts and
// formatEventDate the web's formatTournamentDateLong
// (components/tournaments/tournament-display.tsx).

export function formatCents(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

const eventDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function formatEventDate(timestamp: number) {
  return eventDateFormatter.format(new Date(timestamp));
}
