export function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatRecord(wins: number, losses: number, draws: number) {
  return `${wins}–${losses}–${draws}`;
}

export function displayPlayerName(name: string | null | undefined) {
  return name ?? "Unknown player";
}
