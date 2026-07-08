import { useEffect, useState } from "react";

import {
  formatTimer,
  timerSnapshot,
  type TimerSnapshot,
} from "@tournament-os/shared/timer-utils";

import type { RoundTimer } from "./types";

// Ticks a Convex-synced round timer locally. Pass the roundTimer object from
// whatever query the surface already subscribes to (getPublicTournament,
// getPairingsBoard, getMyCurrentMatch, ...); the server only writes anchors on
// organizer actions, so the countdown itself never touches the network.
//
// Remaining time compares the server-written endsAt against the client's
// Date.now(); typical clock skew is well under a couple of seconds, which is
// fine for a paper-event round timer.
export function useRoundTimer(
  timer: RoundTimer | null | undefined,
): TimerSnapshot & { formatted: string } {
  const [now, setNow] = useState(() => Date.now());

  const running = timer?.kind === "running";
  useEffect(() => {
    if (!running) {
      return;
    }
    setNow(Date.now());
    // 500ms keeps the display from visibly skipping seconds without the churn
    // of requestAnimationFrame (which also pauses in background tabs).
    const interval = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(interval);
  }, [running]);

  const snapshot = timerSnapshot(timer, now);
  return { ...snapshot, formatted: formatTimer(snapshot.remainingMs) };
}
