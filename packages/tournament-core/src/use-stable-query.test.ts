// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

// useQuery stands in for Convex: it hands back whatever the test queued for
// the current argument key, `undefined` meaning "subscription still loading".
const results = new Map<string, unknown>();
vi.mock("convex/react", () => ({
  useQuery: (_query: unknown, args: unknown) =>
    args === "skip" ? undefined : results.get(JSON.stringify(args)),
}));

const { useStableQuery } = await import("./use-stable-query.ts");

type ProbeArgs = Record<string, unknown> | "skip";

let latest: unknown;
function Probe({ args }: { args: ProbeArgs }) {
  // The query reference is irrelevant to the mock.
  latest = useStableQuery({} as never, args as never);
  return null;
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  results.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

function render(args: ProbeArgs) {
  act(() => {
    root.render(createElement(Probe, { args }));
  });
}

test("holds the last result while a changed argument reloads", () => {
  render({ now: 1 });
  expect(latest).toBeUndefined();

  results.set(JSON.stringify({ now: 1 }), ["first"]);
  render({ now: 1 });
  expect(latest).toEqual(["first"]);

  // The clock ticks: the new subscription has nothing yet, so the previous
  // rows stay on screen instead of a loading state.
  render({ now: 2 });
  expect(latest).toEqual(["first"]);

  results.set(JSON.stringify({ now: 2 }), ["second"]);
  render({ now: 2 });
  expect(latest).toEqual(["second"]);
});

test("a change to any argument but the clock drops the held result", () => {
  results.set(JSON.stringify({ tournamentId: "a", now: 1 }), ["a's order"]);
  render({ tournamentId: "a", now: 1 });
  expect(latest).toEqual(["a's order"]);

  // The route's params change in place: the previous event's result must
  // not stand in for the new one's while it loads.
  render({ tournamentId: "b", now: 1 });
  expect(latest).toBeUndefined();

  results.set(JSON.stringify({ tournamentId: "b", now: 1 }), ["b's order"]);
  render({ tournamentId: "b", now: 1 });
  expect(latest).toEqual(["b's order"]);

  // The same identity spelled in another key order is no change.
  render({ now: 2, tournamentId: "b" });
  expect(latest).toEqual(["b's order"]);
});

test("a skip clears the held result", () => {
  results.set(JSON.stringify({ now: 1 }), ["first"]);
  render({ now: 1 });
  expect(latest).toEqual(["first"]);
  render("skip");
  expect(latest).toBeUndefined();
});
