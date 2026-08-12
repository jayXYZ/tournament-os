export function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function formatRecord(wins: number, losses: number, draws: number) {
  return `${wins}–${losses}–${draws}`;
}

// A match's game scoreline. Drawn games are the uncommon case, so they are
// appended only when present: "2–1", but "1–1–1" for a match with a draw.
export function formatGameScoreline(
  gameWins: number,
  gameLosses: number,
  gameDraws: number,
) {
  return gameDraws > 0
    ? `${gameWins}–${gameLosses}–${gameDraws}`
    : `${gameWins}–${gameLosses}`;
}

export function displayPlayerName(name: string | null | undefined) {
  return name ?? "Unknown player";
}

type StandingStatusInput = {
  registrationStatus:
    | "active"
    | "eliminated"
    | "dropped"
    | "disqualified"
    | null
    | undefined;
  playoffStatus?: "not_started" | "active" | "eliminated" | "cut" | null;
  eliminatedInRoundNumber?: number | null;
};

// Status marker shown next to a player's name in standings. Shared by the
// organizer and player views so the two stay symmetrical; only the wording for
// a disqualification differs (players see "Dropped", organizers see "DQ").
export function standingStatusLabel(
  row: StandingStatusInput,
  options: { disqualifiedLabel: string },
) {
  // Standings keep every participant ranked, so non-active players need a
  // marker; a drop or DQ outranks any playoff state.
  if (row.registrationStatus === "dropped") {
    return "Dropped";
  }
  if (row.registrationStatus === "disqualified") {
    return options.disqualifiedLabel;
  }
  if (row.playoffStatus === "active") {
    return "Still active";
  }
  if (row.playoffStatus === "eliminated") {
    return row.eliminatedInRoundNumber == null
      ? "Eliminated"
      : `Eliminated R${row.eliminatedInRoundNumber}`;
  }
  if (row.playoffStatus === "cut") {
    return "Missed cut";
  }
  // Swiss rows have no playoff state; a cut at a phase boundary shows
  // through the live registration instead.
  if (row.registrationStatus === "eliminated") {
    return "Eliminated";
  }
  return null;
}
