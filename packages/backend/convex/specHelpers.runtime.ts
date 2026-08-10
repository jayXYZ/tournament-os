/// <reference types="vite/client" />
// Runtime scaffolding for the *.convex.spec.ts suites. Unlike specHelpers.ts,
// whose imports are type-only so the module stays inert if bundled, this one
// performs runtime imports (convex-test, the rate-limiter component sources)
// that must never reach a deployment. The extra dot in the filename is what
// keeps it out: the Convex CLI skips entry-point files whose basename
// contains more than one dot — the same rule that already excludes the spec
// files themselves.
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";

import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// The one constructor every suite goes through: the app schema plus each
// mounted component (currently only the rate limiter), so no suite can forget
// a component and fail at its first rate-limited mutation.
export function createConvexTest() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return t;
}
