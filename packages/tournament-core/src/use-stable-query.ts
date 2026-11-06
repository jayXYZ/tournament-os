import { useQuery } from "convex/react";
import type { OptionalRestArgsOrSkip } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useRef } from "react";

// useQuery that holds its last result while a new subscription loads.
// Convex returns `undefined` whenever the arguments change until the new
// result arrives, so a query whose arguments include a ticking clock
// (useClientClock) would otherwise flash its surface back to a loading
// state — and unmount anything the rows hosted, like an open confirmation
// dialog — once per tick. Only the initial load (and a 'skip') reports
// `undefined`.
export function useStableQuery<TQuery extends FunctionReference<"query">>(
  query: TQuery,
  ...args: OptionalRestArgsOrSkip<TQuery>
): TQuery["_returnType"] | undefined {
  const result = useQuery(query, ...args);
  const last = useRef<TQuery["_returnType"] | undefined>(undefined);
  if (args[0] === "skip") {
    last.current = undefined;
    return undefined;
  }
  if (result !== undefined) {
    last.current = result;
  }
  return last.current;
}
