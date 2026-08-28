/// <reference types="vite/client" />
// Runtime scaffolding for the *.convex.spec.ts suites. Unlike specHelpers.ts,
// whose imports are type-only so the module stays inert if bundled, this one
// performs runtime imports (convex-test, vitest, the rate-limiter component
// sources) that must never reach a deployment. The extra dot in the filename
// is what keeps it out: the Convex CLI skips entry-point files whose basename
// contains more than one dot — the same rule that already excludes the spec
// files themselves.
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { expect } from "vitest";

import type { Id } from "./_generated/dataModel";
import {
  comparableFromStats,
  compareStandingRows,
  recomputeStatsThroughRound,
} from "./model/standings";
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

// Asserts a completed round's standings rows against the full-history oracle
// (recomputeStatsThroughRound). Rank order is asserted for Swiss rounds;
// single-elimination rounds order by playoff advancement, which callers check
// separately.
export async function expectStandingsMatchOracle(
  t: ReturnType<typeof createConvexTest>,
  tournamentId: Id<"tournaments">,
  roundId: Id<"tournamentRounds">,
  roundNumber: number,
  options: { assertRankOrder: boolean },
) {
  await t.run(async (ctx) => {
    const standings = await ctx.db
      .query("roundStandings")
      .withIndex("by_tournamentRoundId_and_rank", (q) =>
        q.eq("tournamentRoundId", roundId),
      )
      .collect();
    const oracle = await recomputeStatsThroughRound(
      ctx,
      tournamentId,
      roundNumber,
    );
    expect(standings).toHaveLength(oracle.size);

    if (options.assertRankOrder) {
      const expectedOrder = [...oracle.values()].sort((left, right) =>
        compareStandingRows(
          comparableFromStats(left, oracle),
          comparableFromStats(right, oracle),
        ),
      );
      expect(standings.map((row) => row.playerId)).toEqual(
        expectedOrder.map((stats) => stats.registration._id),
      );
    }

    for (const [index, standing] of standings.entries()) {
      const stats = oracle.get(standing.playerId);
      expect(stats).toBeDefined();
      const comparable = comparableFromStats(stats!, oracle);

      expect(standing.rank).toBe(index + 1);
      expect(standing.matchPoints).toBe(stats!.matchPoints);
      expect(standing.matchWins).toBe(stats!.matchWins);
      expect(standing.matchLosses).toBe(stats!.matchLosses);
      expect(standing.matchDraws).toBe(stats!.matchDraws);
      expect(standing.gameWins).toBe(stats!.gameWins);
      expect(standing.gameLosses).toBe(stats!.gameLosses);
      expect(standing.gameDraws).toBe(stats!.gameDraws);
      expect(standing.byeCount).toBe(stats!.byeCount);
      expect(standing.byeGameWins).toBe(stats!.byeGameWins);
      expect([...(standing.opponentIds ?? [])].sort()).toEqual(
        [...stats!.opponentIds].sort(),
      );
      expect(standing.opponentMatchWinPct).toBeCloseTo(
        comparable.opponentMatchWinPct,
        12,
      );
      expect(standing.gameWinPct).toBeCloseTo(comparable.gameWinPct, 12);
      expect(standing.opponentGameWinPct).toBeCloseTo(
        comparable.opponentGameWinPct,
        12,
      );
    }
  });
}
