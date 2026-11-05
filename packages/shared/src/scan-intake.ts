import { type AppLink, parseAppLink } from "./app-links";

// The native scanner's one decision (apps/native/src/app/scan.tsx): what a
// camera read or a typed code does. Both go through scanIntake, so typing a
// code on a simulator, which has no camera, exercises the same decision a
// scan makes on a phone. A link of ours opens; anything else is "not ours"
// and is never opened (see app-links.ts).
//
// The camera reports a code on every frame it stays in view, so camera reads
// pass two gates that typing skips:
//   - the lock: once a code opens, nothing else is taken until the scanner is
//     focused again (rearmScan), so one scan pushes one screen;
//   - the repeat window: the same data is ignored until it has been out of
//     view for SCAN_REPEAT_WINDOW_MS. A QR code from somewhere else held in
//     front of the camera shows its toast once, not once a frame.
// A typed code still respects the lock (a double tap pushes one screen) but
// not the window: submitting the same text twice answers twice.

export const SCAN_REPEAT_WINDOW_MS = 1500;

export type ScanState = {
  locked: boolean;
  // The last camera read and when it was last seen.
  lastRead: { data: string; at: number } | null;
};

export const initialScanState: ScanState = { locked: false, lastRead: null };

export type ScanInput = { source: "camera" | "typed"; text: string };

export type ScanOutcome =
  | { kind: "open"; link: AppLink }
  | { kind: "notOurs" }
  | { kind: "ignored" };

export function scanIntake(
  state: ScanState,
  input: ScanInput,
  now: number,
): { state: ScanState; outcome: ScanOutcome } {
  if (state.locked) {
    return { state, outcome: { kind: "ignored" } };
  }
  let next = state;
  if (input.source === "camera") {
    const last = state.lastRead;
    const repeat =
      last !== null &&
      last.data === input.text &&
      now - last.at < SCAN_REPEAT_WINDOW_MS;
    next = { ...state, lastRead: { data: input.text, at: now } };
    if (repeat) {
      return { state: next, outcome: { kind: "ignored" } };
    }
  }
  const link = parseAppLink(input.text);
  if (link === null) {
    return { state: next, outcome: { kind: "notOurs" } };
  }
  return { state: { ...next, locked: true }, outcome: { kind: "open", link } };
}

// Run when the scanner regains focus, after the player backs out of the
// screen a code opened. The last camera read (after a scan, the code that
// opened that screen) starts a fresh repeat window, so a phone still pointed
// at the same poster doesn't push straight back into it; a different code
// opens at once.
export function rearmScan(state: ScanState, now: number): ScanState {
  return {
    locked: false,
    lastRead: state.lastRead && { data: state.lastRead.data, at: now },
  };
}
