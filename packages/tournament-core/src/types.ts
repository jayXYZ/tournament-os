import type { FunctionReturnType } from "convex/server";

import type { api } from "@tournament-os/backend/convex/_generated/api";
import type { Doc } from "@tournament-os/backend/convex/_generated/dataModel";

export type RoundTimer = NonNullable<Doc<"tournaments">["roundTimer"]>;

export type MyCurrentMatch = FunctionReturnType<
  typeof api.tournaments.player.getMyCurrentMatch
>;
export type MyActiveMatch = Extract<MyCurrentMatch, { kind: "match" }>;
export type MyPlayerMeeting = Extract<
  MyCurrentMatch,
  { kind: "player_meeting" }
>;
export type MyMatchHistory = FunctionReturnType<
  typeof api.tournaments.player.getMyMatchHistory
>;
export type LatestStandings = FunctionReturnType<
  typeof api.tournaments.player.getLatestStandings
>;
export type StandingRow = NonNullable<LatestStandings>["rows"][number];
