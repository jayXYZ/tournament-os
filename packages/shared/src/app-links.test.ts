import { describe, expect, test } from "vitest";

import { parseAppLink } from "./app-links.ts";

describe("parseAppLink", () => {
  test.each([
    // Web join URLs on any host: the scanner never opens them, so the host
    // doesn't matter.
    ["https://paperpairings.app/join/7KQ2MX", "7KQ2MX"],
    ["https://preview-abc.vercel.app/join/7KQ2MX", "7KQ2MX"],
    ["http://localhost:3000/join/7KQ2MX", "7KQ2MX"],
    ["https://paperpairings.app/join/7KQ2MX/", "7KQ2MX"],
    ["https://paperpairings.app/join/7KQ2MX?utm_source=poster", "7KQ2MX"],
    ["https://paperpairings.app/join/7KQ2MX#top", "7KQ2MX"],
    ["HTTPS://PAPERPAIRINGS.APP/JOIN/7kq2mx", "7KQ2MX"],
    ["https://paperpairings.app/join/AB12CD34EF", "AB12CD34EF"],
    // The app's own scheme, as expo-router builds it, and the empty-host form.
    ["paperpairings://join/7KQ2MX", "7KQ2MX"],
    ["paperpairings:///join/AB12CD34EF", "AB12CD34EF"],
    // Bare codes, typed or read off a poster.
    ["7KQ2MX", "7KQ2MX"],
    ["7kq2mx", "7KQ2MX"],
    ["  7KQ2MX\n", "7KQ2MX"],
    ["AB12C-D34EF", "AB12CD34EF"],
    ["ab12c d34ef", "AB12CD34EF"],
    ["https://paperpairings.app/join/AB12C-D34EF", "AB12CD34EF"],
    ["https://paperpairings.app/join/AB12C%20D34EF", "AB12CD34EF"],
    // Lookalike letters pass through: the server maps them, not this parser.
    ["7KQ2MO", "7KQ2MO"],
  ])("%s → join %s", (raw, code) => {
    expect(parseAppLink(raw)).toEqual({ kind: "join", code });
  });

  test.each([
    // Wrong lengths: neither a Public Code nor an Invite Link code.
    ["7KQ2M"],
    ["7KQ2MXA"],
    ["AB12CD34E"],
    ["https://paperpairings.app/join/7KQ2MXA"],
    ["paperpairings://join/"],
    [""],
    ["   "],
    // Not letters and digits.
    ["7KQ2M!"],
    ["https://paperpairings.app/join/7KQ2M%21"],
    // A malformed escape.
    ["https://paperpairings.app/join/7KQ2M%E0"],
    // Other paths and other links, even with a code-shaped segment.
    ["https://paperpairings.app/tournaments/7KQ2MX"],
    ["https://paperpairings.app/join/7KQ2MX/extra"],
    ["https://example.com/7KQ2MX"],
    ["paperpairings://tournaments/7KQ2MX"],
    ["otherapp://join/7KQ2MX"],
    ["mailto:7KQ2MX"],
    ["WIFI:S:cafe;T:WPA;P:secret;;"],
    ["https://paperpairings.app/join"],
  ])("%j → null", (raw) => {
    expect(parseAppLink(raw)).toBeNull();
  });
});
