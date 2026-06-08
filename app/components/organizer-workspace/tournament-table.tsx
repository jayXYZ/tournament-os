import { CalendarDays } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Tournament } from "./types";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function TournamentTable({
  tournaments,
}: {
  tournaments: Tournament[] | undefined;
}) {
  if (tournaments === undefined) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Loading tournaments</CardTitle>
          <CardDescription>
            Fetching events for the selected organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {[0, 1, 2].map((row) => (
              <Skeleton key={row} className="h-12" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (tournaments.length === 0) {
    return (
      <Card>
        <CardContent>
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CalendarDays />
              </EmptyMedia>
              <EmptyTitle>No upcoming tournaments</EmptyTitle>
              <EmptyDescription>
                Future tournaments for this organization will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tournament schedule</CardTitle>
        <CardDescription>Upcoming organization tournaments.</CardDescription>
      </CardHeader>
      <CardContent>
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>Tournament</TableHead>
              <TableHead>Format</TableHead>
              <TableHead>Start date</TableHead>
              <TableHead>Capacity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tournaments.map((tournament) => (
              <TournamentRow key={tournament._id} tournament={tournament} />
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TournamentRow({ tournament }: { tournament: Tournament }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          <p className="font-medium text-foreground">{tournament.name}</p>
          {tournament.isTestEvent ? (
            <Badge variant="secondary">Test</Badge>
          ) : null}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {tournament.isTestEvent ? "Test event" : "Organization event"}
        </p>
      </TableCell>
      <TableCell className="capitalize">{tournament.format}</TableCell>
      <TableCell>
        {dateFormatter.format(new Date(tournament.startDate))}
      </TableCell>
      <TableCell>{tournament.playerCapacity}</TableCell>
      <TableCell className="capitalize">{tournament.status}</TableCell>
      <TableCell className="text-right">
        <Button type="button" variant="outline" disabled>
          Manage soon
        </Button>
      </TableCell>
    </TableRow>
  );
}
