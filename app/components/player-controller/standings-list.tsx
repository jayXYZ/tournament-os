"use client";

import { useState } from "react";
import {
  formatPercent,
  formatRecord,
  useLatestStandings,
  type StandingRow,
} from "@tournament-os/core";
import { ListOrdered } from "lucide-react";

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
import { Skeleton } from "@/components/ui/skeleton";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

export function StandingsList({
  tournamentId,
}: {
  tournamentId: Id<"tournaments">;
}) {
  const standings = useLatestStandings(tournamentId);

  if (standings === undefined) {
    return <Skeleton className="h-56" />;
  }

  if (standings === null) {
    return (
      <Empty className="min-h-60 border bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListOrdered aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle>No standings yet</EmptyTitle>
          <EmptyDescription>
            Standings appear after the first round is completed.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const myRow = standings.rows.find((row) => row.isMe);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Standings</CardTitle>
        <CardDescription>
          After round {standings.roundNumber}
          {myRow
            ? ` · You're ${ordinal(myRow.rank)} with ${myRow.matchPoints} ${
                myRow.matchPoints === 1 ? "point" : "points"
              }`
            : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1.5">
        {standings.rows.map((row) => (
          <StandingsRow key={row.rank} row={row} />
        ))}
      </CardContent>
    </Card>
  );
}

function StandingsRow({ row }: { row: StandingRow }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setExpanded((value) => !value)}
      aria-expanded={expanded}
      className={cn(
        "rounded-md border px-3 py-2 text-left",
        row.isMe ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <div className="flex items-center gap-3">
        <span className="w-7 shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">
          {row.rank}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {row.name ?? "Unknown player"}
          {row.isMe ? (
            <span className="text-muted-foreground"> (you)</span>
          ) : null}
        </span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatRecord(row.matchWins, row.matchLosses, row.matchDraws)}
        </span>
        <span className="w-10 text-right text-sm font-semibold tabular-nums">
          {row.matchPoints}
        </span>
      </div>
      {expanded ? (
        <p className="mt-1.5 pl-10 text-xs text-muted-foreground">
          OMW {formatPercent(row.opponentMatchWinPct)} · GW{" "}
          {formatPercent(row.gameWinPct)} · OGW{" "}
          {formatPercent(row.opponentGameWinPct)}
        </p>
      ) : null}
    </button>
  );
}

function ordinal(value: number) {
  const remainderTen = value % 10;
  const remainderHundred = value % 100;
  if (remainderTen === 1 && remainderHundred !== 11) {
    return `${value}st`;
  }
  if (remainderTen === 2 && remainderHundred !== 12) {
    return `${value}nd`;
  }
  if (remainderTen === 3 && remainderHundred !== 13) {
    return `${value}rd`;
  }
  return `${value}th`;
}
