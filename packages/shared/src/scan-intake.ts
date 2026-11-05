import { type AppLink, parseAppLink } from "./app-links";

// The native scanner's one decision (apps/native/src/app/scan.tsx): what a
// camera read or a typed code does. Both go through scanIntake, so typing a
// code on a simulator, which has no camera, exercises the same decision a
// scan makes on a phone. A link of ours opens; anything else is "not ours"
// and is never opened (see app-links.ts).
//
// The camera reports each code on every frame it stays in view (two codes
// in view read alternately), so camera reads pass two gates that typing
// skips:
//   - the lock: once a code opens, nothing else is taken until the scanner is
//     focused again (rearmScan), so one scan pushes one screen;
//   - the repeat window: each recently read payload is ignored until it has
//     been out of view for SCAN_REPEAT_WINDOW_MS. A QR code from somewhere
//     else held in front of the camera shows its toast once, not once a
//     frame, even beside another code.
// A typed code still respects the lock (a double tap pushes one screen) but
// not the window: submitting the same text twice answers twice.

export const SCAN_REPEAT_WINDOW_MS = 1500;

// How many recent payloads the repeat window remembers. More codes than this
// in view at once can answer more than once; nothing else is lost.
export const SCAN_MEMORY_SIZE = 8;

export type ScanState = {
  locked: boolean;
  // Recent camera reads, each payload once with when it was last seen,
  // oldest first: a small map from payload to time, kept as a list so the
  // state stays plain data. Reads out of view for a full window drop out,
  // and it holds at most SCAN_MEMORY_SIZE.
  recentReads: ReadonlyArray<{ data: string; at: number }>;
};

export const initialScanState: ScanState = { locked: false, recentReads: [] };

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
    const inWindow = state.recentReads.filter(
      (read) => now - read.at < SCAN_REPEAT_WINDOW_MS,
    );
    const repeat = inWindow.some((read) => read.data === input.text);
    next = {
      ...state,
      recentReads: [
        ...inWindow.filter((read) => read.data !== input.text),
        { data: input.text, at: now },
      ].slice(-SCAN_MEMORY_SIZE),
    };
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
// screen a code opened. Every remembered camera read (the code that opened
// that screen, and any read beside it) starts a fresh repeat window, so a
// phone still pointed at the same poster doesn't push straight back into it;
// a different code opens at once.
export function rearmScan(state: ScanState, now: number): ScanState {
  return { locked: false, recentReads: restartWindows(state, now) };
}

function restartWindows(state: ScanState, now: number) {
  return state.recentReads.map(({ data }) => ({ data, at: now }));
}
