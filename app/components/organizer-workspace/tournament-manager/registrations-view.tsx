"use client";

import { ClipboardList } from "lucide-react";

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

export function RegistrationsView({ tournamentId }: { tournamentId: string }) {
  void tournamentId;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Tournament manager
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal">
          Registrations
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Player registrations</CardTitle>
          <CardDescription>
            Review and manage the players signed up for this tournament.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Empty className="min-h-64">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ClipboardList />
              </EmptyMedia>
              <EmptyTitle>Registrations coming soon</EmptyTitle>
              <EmptyDescription>
                Roster management, check-in, and drop controls will live here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </CardContent>
      </Card>
    </section>
  );
}
