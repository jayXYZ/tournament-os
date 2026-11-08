import { describe, expect, test } from "vitest";

import {
  initialScanState,
  rearmScan,
  restartScanWindow,
  SCAN_MEMORY_SIZE,
  SCAN_REPEAT_WINDOW_MS,
  type ScanInput,
  type ScanOutcome,
  type ScanState,
  scanIntake,
} from "./scan-intake.ts";

const POSTER = "https://paperpairings.app/join/7KQ2MX";
const OTHER_POSTER = "https://paperpairings.app/join/AB12CD34EF";
const ELSEWHERE = "https://example.com/menu";
const OTHER_ELSEWHERE = "https://example.com/wifi";

const camera = (text: string): ScanInput => ({ source: "camera", text });
const typed = (text: string): ScanInput => ({ source: "typed", text });

// Feeds reads through scanIntake in order and returns each outcome's kind
// (with the code for an open), plus the final state.
function feed(
  reads: [ScanInput, number][],
  start: ScanState = initialScanState,
): { outcomes: string[]; state: ScanState } {
  let state = start;
  const outcomes = reads.map(([input, at]) => {
    const result = scanIntake(state, input, at);
    state = result.state;
    return describeOutcome(result.outcome);
  });
  return { outcomes, state };
}

function describeOutcome(outcome: ScanOutcome): string {
  return outcome.kind === "open" ? `open ${outcome.link.code}` : outcome.kind;
}

describe("scanIntake from the camera", () => {
  test("a code of ours opens once and locks out every later read", () => {
    const { outcomes, state } = feed([
      [camera(POSTER), 0],
      [camera(POSTER), 30],
      [camera(OTHER_POSTER), 5000],
    ]);
    expect(outcomes).toEqual(["open 7KQ2MX", "ignored", "ignored"]);
    expect(state.locked).toBe(true);
  });

  test("a code from elsewhere answers once while it stays in view", () => {
    const { outcomes, state } = feed([
      [camera(ELSEWHERE), 0],
      // Every frame refreshes the window, so a code held in view stays quiet.
      [camera(ELSEWHERE), SCAN_REPEAT_WINDOW_MS - 1],
      [camera(ELSEWHERE), 2 * SCAN_REPEAT_WINDOW_MS - 2],
      // Out of view for a full window, then back.
      [camera(ELSEWHERE), 4 * SCAN_REPEAT_WINDOW_MS],
    ]);
    expect(outcomes).toEqual(["notOurs", "ignored", "ignored", "notOurs"]);
    expect(state.locked).toBe(false);
  });

  // expo-camera reports each code in view once per frame, so two codes in
  // view read alternately; each still answers once.
  test("two codes from elsewhere in view together each answer once", () => {
    expect(
      feed([
        [camera(ELSEWHERE), 0],
        [camera(OTHER_ELSEWHERE), 30],
        [camera(ELSEWHERE), 60],
        [camera(OTHER_ELSEWHERE), 90],
        [camera(ELSEWHERE), 120],
      ]).outcomes,
    ).toEqual(["notOurs", "notOurs", "ignored", "ignored", "ignored"]);
  });

  test("remembers at most SCAN_MEMORY_SIZE codes in view at once", () => {
    const codes = Array.from(
      { length: SCAN_MEMORY_SIZE + 1 },
      (_, index) => `https://example.com/${index}`,
    );
    const { outcomes } = feed(
      [...codes, codes[0]!].map((code, index) => [camera(code), index * 10]),
    );
    // The first code fell out of memory when the ninth arrived.
    expect(outcomes.at(-1)).toBe("notOurs");
    expect(
      feed(
        [...codes.slice(1), codes[1]!].map((code, index) => [
          camera(code),
          index * 10,
        ]),
      ).outcomes.at(-1),
    ).toBe("ignored");
  });

  test("a different code inside the window is read at once", () => {
    expect(
      feed([
        [camera(ELSEWHERE), 0],
        [camera(POSTER), 100],
      ]).outcomes,
    ).toEqual(["notOurs", "open 7KQ2MX"]);
  });
});

describe("rearmScan", () => {
  const opened = feed([[camera(POSTER), 0]]).state;

  test("unlocks, but the code that opened stays quiet while still in view", () => {
    const rearmed = rearmScan(opened, 10_000);
    expect(rearmed.locked).toBe(false);
    expect(
      feed(
        [
          [camera(POSTER), 10_100],
          [camera(POSTER), 10_100 + SCAN_REPEAT_WINDOW_MS - 1],
          [camera(POSTER), 10_100 + 3 * SCAN_REPEAT_WINDOW_MS],
        ],
        rearmed,
      ).outcomes,
    ).toEqual(["ignored", "ignored", "open 7KQ2MX"]);
  });

  // A Join QR beside a foreign one: after backing out, reads alternate
  // between them, and the foreign read must not reopen the Join QR's window.
  test("a code beside another stays quiet after rearming", () => {
    const rearmed = rearmScan(opened, 10_000);
    expect(
      feed(
        [
          [camera(ELSEWHERE), 10_030],
          [camera(POSTER), 10_060],
          [camera(ELSEWHERE), 10_090],
          [camera(POSTER), 10_120],
        ],
        rearmed,
      ).outcomes,
    ).toEqual(["notOurs", "ignored", "ignored", "ignored"]);
  });

  test("a different code opens right after rearming", () => {
    expect(
      feed([[camera(OTHER_POSTER), 10_100]], rearmScan(opened, 10_000))
        .outcomes,
    ).toEqual(["open AB12CD34EF"]);
  });

  test("before any camera read, it only unlocks", () => {
    const afterTyping = feed([[typed("7KQ2MX"), 0]]).state;
    expect(rearmScan(afterTyping, 10_000)).toEqual(initialScanState);
  });
});

// The camera mounts when the scanner regains focus and needs a moment
// before it reads anything, so the window restarts again once it is ready.
describe("restartScanWindow", () => {
  const rearmed = rearmScan(feed([[camera(POSTER), 0]]).state, 10_000);

  test("a code still in view when the camera is ready stays quiet", () => {
    // Ready 2 s after focus: without the restart, the first read is
    // already past the window rearmScan started.
    expect(
      feed([[camera(POSTER), 12_100]], restartScanWindow(rearmed, 12_000))
        .outcomes,
    ).toEqual(["ignored"]);
    expect(feed([[camera(POSTER), 12_100]], rearmed).outcomes).toEqual([
      "open 7KQ2MX",
    ]);
  });

  test("leaves the lock as it was", () => {
    const locked = feed([[camera(POSTER), 0]]).state;
    expect(restartScanWindow(locked, 5_000).locked).toBe(true);
    expect(restartScanWindow(rearmed, 12_000).locked).toBe(false);
  });

  test("a different code opens once the camera is ready", () => {
    expect(
      feed([[camera(OTHER_POSTER), 12_100]], restartScanWindow(rearmed, 12_000))
        .outcomes,
    ).toEqual(["open AB12CD34EF"]);
  });
});

describe("scanIntake from typed text", () => {
  // The same parse as a scan (parseAppLink's own table covers the rest).
  test.each([
    [" 7kq2mx ", "open 7KQ2MX"],
    ["AB12C-D34EF", "open AB12CD34EF"],
    [POSTER, "open 7KQ2MX"],
    [ELSEWHERE, "notOurs"],
  ])("%s → %s", (text, outcome) => {
    expect(feed([[typed(text), 0]]).outcomes).toEqual([outcome]);
  });

  test("answers every submit of a non-code, with no repeat window", () => {
    expect(
      feed([
        [typed(ELSEWHERE), 0],
        [typed(ELSEWHERE), 10],
        [typed("hello"), 20],
      ]).outcomes,
    ).toEqual(["notOurs", "notOurs", "notOurs"]);
  });

  test("respects the lock a scan set, and sets it for the camera", () => {
    expect(
      feed([
        [camera(POSTER), 0],
        [typed("AB12CD34EF"), 10],
      ]).outcomes,
    ).toEqual(["open 7KQ2MX", "ignored"]);
    expect(
      feed([
        [typed("7KQ2MX"), 0],
        [camera(OTHER_POSTER), 10],
      ]).outcomes,
    ).toEqual(["open 7KQ2MX", "ignored"]);
  });
});
