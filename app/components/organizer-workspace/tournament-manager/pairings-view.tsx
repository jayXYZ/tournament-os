"use client";

import { Swords } from "lucide-react";

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

export function PairingsView({ tournamentId }: { tournamentId: string }) {
  void tournamentId;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Tournament manager
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal">
          Pairings
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Round pairings</CardTitle>
          <CardDescription>
            Generate rounds, view table assignments, and record match results.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Swords />
              </EmptyMedia>
              <EmptyTitle>Pairings coming soon</EmptyTitle>
              <EmptyDescription>
                Round generation and per-table result entry will live here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </section>
  );
}
