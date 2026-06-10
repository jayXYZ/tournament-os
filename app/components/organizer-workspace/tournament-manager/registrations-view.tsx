"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import {
  ClipboardList,
  FlaskConical,
  MoreHorizontal,
  Settings2,
  UserMinus,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

type RegistrationRow = {
  registration: Doc<"tournamentRegistrations">;
  user: Doc<"users"> | null;
};

type RegistrationStatus = Doc<"tournamentRegistrations">["status"];

const statusBadgeVariant: Record<
  RegistrationStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  pending: "outline",
  eliminated: "secondary",
  dropped: "destructive",
  disqualified: "destructive",
};

function playerName(row: RegistrationRow) {
  return row.user?.name ?? row.user?.email ?? "Unknown player";
}

export function RegistrationsView({ tournamentId }: { tournamentId: string }) {
  const registrations = useQuery(api.tournaments.listRegistrations, {
    tournamentId: tournamentId as Id<"tournaments">,
  });
  const setup = useQuery(api.tournaments.getTournamentSetup, {
    tournamentId: tournamentId as Id<"tournaments">,
  });

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
          <CardAction>
            <RegistrationSettingsMenu tournament={setup?.tournament} />
          </CardAction>
        </CardHeader>
        <CardContent>
          <RegistrationsTable registrations={registrations} />
        </CardContent>
      </Card>
    </section>
  );
}

function RegistrationSettingsMenu({
  tournament,
}: {
  tournament: Doc<"tournaments"> | undefined;
}) {
  const seedTestPlayers = useMutation(api.tournaments.seedTestPlayers);
  const [busy, setBusy] = useState(false);

  const canGenerate = tournament !== undefined && tournament.isTestEvent;

  async function handleGenerateTestUsers() {
    if (!tournament) {
      return;
    }

    setBusy(true);
    try {
      await seedTestPlayers({
        tournamentId: tournament._id,
        count: tournament.playerCapacity,
      });
      toast.success("Test users generated.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not generate test users.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Registration settings"
        >
          {busy ? <Spinner /> : <Settings2 />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={!canGenerate || busy}
            onSelect={() => void handleGenerateTestUsers()}
          >
            <FlaskConical />
            Generate Test Users
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RegistrationsTable({
  registrations,
}: {
  registrations: RegistrationRow[] | undefined;
}) {
  if (registrations === undefined) {
    return (
      <div className="grid gap-3">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-12" />
        ))}
      </div>
    );
  }

  if (registrations.length === 0) {
    return (
      <Empty className="min-h-64">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClipboardList />
          </EmptyMedia>
          <EmptyTitle>No registrations yet</EmptyTitle>
          <EmptyDescription>
            Players who sign up for this tournament will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table className="min-w-[480px]">
      <TableHeader>
        <TableRow>
          <TableHead>Player</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Manage</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {registrations.map((row) => (
          <RegistrationRow key={row.registration._id} row={row} />
        ))}
      </TableBody>
    </Table>
  );
}

function RegistrationRow({ row }: { row: RegistrationRow }) {
  const { registration } = row;

  return (
    <TableRow>
      <TableCell>
        <p className="font-medium text-foreground">{playerName(row)}</p>
      </TableCell>
      <TableCell>
        <Badge
          variant={statusBadgeVariant[registration.status]}
          className="capitalize"
        >
          {registration.status}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <ManagePlayerMenu row={row} />
      </TableCell>
    </TableRow>
  );
}

function ManagePlayerMenu({ row }: { row: RegistrationRow }) {
  const dropRegistration = useMutation(api.tournaments.dropRegistration);

  const [confirmingDrop, setConfirmingDrop] = useState(false);
  const [busy, setBusy] = useState(false);

  const alreadyDropped = row.registration.status === "dropped";

  async function handleDrop() {
    setBusy(true);
    try {
      await dropRegistration({ registrationId: row.registration._id });
      setConfirmingDrop(false);
      toast.success(`${playerName(row)} has been dropped.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not drop player.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={`Manage ${playerName(row)}`}
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              variant="destructive"
              disabled={alreadyDropped}
              onSelect={() => setConfirmingDrop(true)}
            >
              <UserMinus />
              Drop player
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirmingDrop}
        onOpenChange={(open) => {
          if (!busy) {
            setConfirmingDrop(open);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <UserMinus />
            </AlertDialogMedia>
            <AlertDialogTitle>Drop {playerName(row)}?</AlertDialogTitle>
            <AlertDialogDescription>
              This player will be removed from future pairings and their
              status will be set to dropped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void handleDrop();
              }}
            >
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Drop player
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
