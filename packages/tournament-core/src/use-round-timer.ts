import { useEffect, useState } from "react";

import {
  extendRoundTimer,
  formatTimer,
  timerSnapshot,
  type MatchTimeExtension,
  type TimerSnapshot,
} from "@paper-pairings/shared/timer-utils";

import type { RoundTimer } from "./types";

// Ticks a Convex-synced round timer locally. Pass the roundTimer object from
// whatever query the surface already subscribes to (getPublicTournament,
// getPairingsBoard, getMyCurrentMatch, ...); the server only writes anchors on
// organizer actions, so the countdown itself never touches the network.
//
// Pass the viewer's match time extension (the Player View's
// match.timeExtension) to count down to that match's own deadline instead of
// the round's; extensionMs echoes the granted amount for the "+5 min" marker,
// null when no extension applies.
//
// Remaining time compares the server-written endsAt against the client's
// Date.now(); typical clock skew is well under a couple of seconds, which is
// fine for a paper-event round timer.
export function useRoundTimer(
  timer: RoundTimer | null | undefined,
  extension?: MatchTimeExtension | null,
): TimerSnapshot & { formatted: string; extensionMs: number | null } {
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

  const snapshot = timerSnapshot(extendRoundTimer(timer, extension), now);
  return {
    ...snapshot,
    formatted: formatTimer(snapshot.remainingMs),
    extensionMs: extension?.extensionMs ?? null,
  };
}
