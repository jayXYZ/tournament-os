import { useQuery } from "convex/react";
import type { OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useRef } from "react";

// useQuery that holds its last result while the clock argument reloads it.
// Convex returns `undefined` whenever the arguments change until the new
// result arrives, so a query whose arguments include a ticking clock
// (useClientClock) would otherwise flash its surface back to a loading
// state — and unmount anything the rows hosted, like an open confirmation
// dialog — once per tick. Only `now`, the clock argument every
// time-dependent query takes, is held across: a change to any other
// argument (another tournament id, when a route updates its params in
// place and the component stays mounted) or a 'skip' drops the held result,
// so one identity's rows never stand in for another's while they load. The
// initial load reports `undefined`.
export function useStableQuery<TQuery extends FunctionReference<"query">>(
  query: TQuery,
  ...args: OptionalRestArgsOrSkip<TQuery>
): TQuery["_returnType"] | undefined {
  const result = useQuery(query, ...args);
  const identity = argsIdentity(args[0]);
  const last = useRef<{
    identity: string;
    result: TQuery["_returnType"] | undefined;
  }>({ identity, result: undefined });
  if (last.current.identity !== identity) {
    last.current = { identity, result: undefined };
  }
  if (result !== undefined) {
    last.current.result = result;
  }
  return last.current.result;
}

// The arguments without the clock, as a comparable string: the identity a
// held result belongs to. Keys are sorted so the order a caller spells them
// in is not a change.
function argsIdentity(args: unknown): string {
  if (typeof args !== "object" || args === null) {
    return JSON.stringify(args ?? null);
  }
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(args)
        .filter(([key]) => key !== "now")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  );
}
