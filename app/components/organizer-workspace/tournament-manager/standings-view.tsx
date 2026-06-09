"use client";

import { Trophy } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function StandingsView({ tournamentId }: { tournamentId: string }) {
  void tournamentId;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Tournament manager
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal">
          Standings
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tournament standings</CardTitle>
          <CardDescription>
            Track ranks, match points, and tiebreakers across rounds.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Trophy />
              </EmptyMedia>
              <EmptyTitle>Standings coming soon</EmptyTitle>
              <EmptyDescription>
                Live leaderboard and tiebreaker breakdowns will live here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </section>
  );
}
