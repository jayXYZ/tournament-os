
import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ClipboardPen,
  FlaskConical,
  ListOrdered,
  MoreHorizontal,
  Settings2,
  Swords,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@tournament-os/backend/convex/_generated/api";
import type { Id } from "@tournament-os/backend/convex/_generated/dataModel";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PairingsBoard = FunctionReturnType<
  typeof api.tournaments.rounds.getPairingsBoard
>;
type PairingRow = FunctionReturnType<
  typeof api.tournaments.rounds.listRoundPairings
>[number];
type PairedPlayer = PairingRow["players"][number];
type AdvanceStep = Exclude<
  PairingsBoard["nextStep"],
  { kind: "tournamentCompleted" } | { kind: "tournamentCancelled" }
>;

export function PairingsView({ tournamentId }: { tournamentId: string }) {
  const board = useQuery(api.tournaments.rounds.getPairingsBoard, {
    tournamentId: tournamentId as Id<"tournaments">,
  });

  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [selectedRoundNumber, setSelectedRoundNumber] = useState<
    number | null
  >(null);

  const phases = board?.phases ?? [];
  const defaultPhase =
    phases.find(({ phase }) => phase.phaseStatus === "in_progress") ??
    phases[0];
  const activePhase =
    phases.find(({ phase }) => phase._id === selectedPhaseId) ?? defaultPhase;
  const rounds = activePhase?.rounds ?? [];
  const latestRound = rounds[rounds.length - 1];
  const selectedRound =
    rounds.find((round) => round.roundNumber === selectedRoundNumber) ??
    latestRound;
  const roundTabCount = Math.max(
    activePhase?.phase.phaseTotalRounds ?? 0,
    rounds.length,
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Tournament manager
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            Pairings
          </h1>
        </div>
        <AdvanceStepButton
          board={board}
          onAdvanced={() => setSelectedRoundNumber(null)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Round pairings</CardTitle>
          <CardDescription>
            View table assignments and match results for each round.
          </CardDescription>
          <CardAction>
            <PairingsSettingsMenu
              board={board}
              roundId={selectedRound?._id ?? null}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {board === undefined ? (
            <div className="grid gap-3">
              {[0, 1, 2].map((row) => (
                <Skeleton key={row} className="h-12" />
              ))}
            </div>
          ) : (
            <>
              {phases.length > 1 && activePhase ? (
                <Tabs
                  value={activePhase.phase._id}
                  onValueChange={(value) => {
                    setSelectedPhaseId(value);
                    setSelectedRoundNumber(null);
                  }}
                >
                  <TabsList>
                    {phases.map(({ phase }) => (
                      <TabsTrigger
                        key={phase._id}
                        value={phase._id}
                        disabled={phase.phaseStatus === "upcoming"}
                      >
                        {phase.phaseName ?? `Phase ${phase.phaseOrder}`}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              ) : null}

              {rounds.length === 0 || !selectedRound ? (
                <Empty className="min-h-64">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <Swords />
                    </EmptyMedia>
                    <EmptyTitle>No pairings yet</EmptyTitle>
                    <EmptyDescription>
                      Generate pairings to create the first round and assign
                      players to tables.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <>
                  <Tabs
                    value={String(selectedRound.roundNumber)}
                    onValueChange={(value) =>
                      setSelectedRoundNumber(Number(value))
                    }
                  >
                    <TabsList>
                      {Array.from({ length: roundTabCount }, (_, index) => {
                        const roundNumber = index + 1;
                        const exists = rounds.some(
                          (round) => round.roundNumber === roundNumber,
                        );
                        return (
                          <TabsTrigger
                            key={roundNumber}
                            value={String(roundNumber)}
                            disabled={!exists}
                          >
                            Round {roundNumber}
                          </TabsTrigger>
                        );
                      })}
                    </TabsList>
                  </Tabs>
                  <PairingsTable roundId={selectedRound._id} />
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function PairingsSettingsMenu({
  board,
  roundId,
}: {
  board: PairingsBoard | undefined;
  roundId: Id<"tournamentRounds"> | null;
}) {
  const generateTestRoundResults = useMutation(
    api.tournaments.testing.generateTestRoundResults,
  );
  const [busy, setBusy] = useState(false);

  const canSimulate =
    board !== undefined && board.tournament.isTestEvent && roundId !== null;

  async function handleSimulateResults() {
    if (!board || !roundId) {
      return;
    }

    setBusy(true);
    try {
      await generateTestRoundResults({
        tournamentId: board.tournament._id,
        roundId,
      });
      toast.success("Match results simulated.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not simulate match results.",
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
          aria-label="Pairings settings"
        >
          {busy ? <Spinner /> : <Settings2 />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={!canSimulate || busy}
            onSelect={() => void handleSimulateResults()}
          >
            <FlaskConical />
            Simulate Match Results
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AdvanceStepButton({
  board,
  onAdvanced,
}: {
  board: PairingsBoard | undefined;
  onAdvanced: () => void;
}) {
  const startTournament = useMutation(api.tournaments.rounds.startTournament);
  const generateNextRound = useMutation(api.tournaments.rounds.generateNextRound);
  const completeRound = useMutation(api.tournaments.rounds.completeRound);
  const completeTournament = useMutation(api.tournaments.lifecycle.completeTournament);
  const [busy, setBusy] = useState(false);

  if (board === undefined) {
    return <Skeleton className="h-8 w-44" />;
  }

  const step = board.nextStep;
  if (step.kind === "tournamentCancelled") {
    return <Badge variant="destructive">Tournament cancelled</Badge>;
  }
  if (step.kind === "tournamentCompleted") {
    return (
      <Button type="button" disabled>
        <Trophy />
        Tournament complete
      </Button>
    );
  }

  const action = advanceAction(step, board.tournament._id, {
    startTournament,
    generateNextRound,
    completeRound,
    completeTournament,
  });

  async function handleAdvance() {
    setBusy(true);
    try {
      await action.run();
      toast.success(action.success);
      onAdvanced();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not advance the tournament.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        disabled={!step.ready || busy}
        onClick={() => void handleAdvance()}
      >
        {busy ? <Spinner /> : action.icon}
        {action.label}
      </Button>
      {!step.ready && step.reason ? (
        <p className="text-xs text-muted-foreground">{step.reason}</p>
      ) : null}
    </div>
  );
}

function advanceAction(
  step: AdvanceStep,
  tournamentId: Id<"tournaments">,
  mutations: {
    startTournament: (args: {
      tournamentId: Id<"tournaments">;
    }) => Promise<unknown>;
    generateNextRound: (args: {
      tournamentId: Id<"tournaments">;
    }) => Promise<unknown>;
    completeRound: (args: {
      roundId: Id<"tournamentRounds">;
    }) => Promise<unknown>;
    completeTournament: (args: {
      tournamentId: Id<"tournaments">;
    }) => Promise<unknown>;
  },
) {
  switch (step.kind) {
    case "startTournament":
      return {
        label: "Generate pairings",
        icon: <Swords />,
        success: "Round 1 pairings generated.",
        run: () => mutations.startTournament({ tournamentId }),
      };
    case "generateStandings":
      return {
        label: "Generate standings",
        icon: <ListOrdered />,
        success: "Standings generated and round completed.",
        run: () => mutations.completeRound({ roundId: step.roundId }),
      };
    case "generateNextRound":
      return {
        label: "Generate pairings",
        icon: <Swords />,
        success: "Next round pairings generated.",
        run: () => mutations.generateNextRound({ tournamentId }),
      };
    case "completeTournament":
      return {
        label: "Complete tournament",
        icon: <Trophy />,
        success: "Tournament completed.",
        run: () => mutations.completeTournament({ tournamentId }),
      };
  }
}

function PairingsTable({ roundId }: { roundId: Id<"tournamentRounds"> }) {
  const pairings = useQuery(api.tournaments.rounds.listRoundPairings, { roundId });

  if (pairings === undefined) {
    return (
      <div className="grid gap-3">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-12" />
        ))}
      </div>
    );
  }

  if (pairings.length === 0) {
    return (
      <Empty className="min-h-64">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Swords />
          </EmptyMedia>
          <EmptyTitle>No matches in this round</EmptyTitle>
          <EmptyDescription>
            Pairings for this round will appear here once they are generated.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <Table className="min-w-[640px]">
      <TableHeader>
        <TableRow>
          <TableHead className="w-20">Table</TableHead>
          <TableHead>Players</TableHead>
          <TableHead>Result</TableHead>
          <TableHead className="text-right">Manage</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pairings.map((row) => (
          <PairingTableRow key={row.match._id} row={row} />
        ))}
      </TableBody>
    </Table>
  );
}

function pairedPlayerName(player: PairedPlayer | undefined) {
  return player?.user?.name ?? player?.user?.email ?? "Unknown player";
}

function PairingTableRow({ row }: { row: PairingRow }) {
  const [playerOne, playerTwo] = row.players;
  const isBye = row.players.some((player) => player.isBye);

  return (
    <TableRow>
      <TableCell className="font-medium tabular-nums">
        {row.match.tableNumber ?? (
          <span className="text-muted-foreground">&mdash;</span>
        )}
      </TableCell>
      <TableCell>
        <p className="font-medium text-foreground">
          {pairedPlayerName(playerOne)}
          {isBye ? null : (
            <span className="font-normal text-muted-foreground"> vs.</span>
          )}
        </p>
        {isBye ? (
          <Badge variant="secondary" className="mt-1">
            Bye
          </Badge>
        ) : (
          <p className="font-medium text-foreground">
            {pairedPlayerName(playerTwo)}
          </p>
        )}
      </TableCell>
      <TableCell>
        <MatchResultCell row={row} />
      </TableCell>
      <TableCell className="text-right">
        <ManageMatchMenu row={row} />
      </TableCell>
    </TableRow>
  );
}

function MatchResultCell({ row }: { row: PairingRow }) {
  const [playerOne, playerTwo] = row.players;
  const hasResult =
    row.match.matchStatus === "completed" ||
    row.match.matchStatus === "confirmed";

  if (!hasResult) {
    return <Badge variant="outline">Awaiting result</Badge>;
  }

  const playerOneWins = playerOne?.gameWins ?? 0;
  const playerTwoWins = playerOne?.isBye
    ? playerOne?.gameLosses ?? 0
    : playerTwo?.gameWins ?? 0;

  if (playerOneWins === playerTwoWins) {
    return (
      <ResultWithProvenance row={row}>
        Draw {playerOneWins}&ndash;{playerTwoWins}
      </ResultWithProvenance>
    );
  }

  const playerOneWon = playerOneWins > playerTwoWins;
  const winnerName = pairedPlayerName(playerOneWon ? playerOne : playerTwo);
  const winnerWins = playerOneWon ? playerOneWins : playerTwoWins;
  const loserWins = playerOneWon ? playerTwoWins : playerOneWins;

  return (
    <ResultWithProvenance row={row}>
      {winnerName} wins {winnerWins}&ndash;{loserWins}
    </ResultWithProvenance>
  );
}

// Distinguishes player self-reported results from organizer-entered ones, so
// the organizer can spot unconfirmed reports before completing the round.
function ResultWithProvenance({
  row,
  children,
}: {
  row: PairingRow;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{children}</span>
      {row.match.matchStatus === "confirmed" ? (
        <Badge variant="secondary">Confirmed by players</Badge>
      ) : row.match.reportedByRegistrationId !== undefined ? (
        <Badge variant="outline">Player-reported &middot; unconfirmed</Badge>
      ) : null}
    </div>
  );
}

function ManageMatchMenu({ row }: { row: PairingRow }) {
  const isBye = row.players.some((player) => player.isBye);
  const [enteringResult, setEnteringResult] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label={
              row.match.tableNumber === undefined
                ? "Manage bye match"
                : `Manage table ${row.match.tableNumber}`
            }
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem
              disabled={isBye}
              onSelect={() => setEnteringResult(true)}
            >
              <ClipboardPen />
              Enter result
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {enteringResult ? (
        <EnterResultDialog
          row={row}
          open={enteringResult}
          onOpenChange={setEnteringResult}
        />
      ) : null}
    </>
  );
}

function EnterResultDialog({
  row,
  open,
  onOpenChange,
}: {
  row: PairingRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const recordMatchResult = useMutation(api.tournaments.rounds.recordMatchResult);
  const [playerOne, playerTwo] = row.players;

  const [busy, setBusy] = useState(false);
  const [playerOneWins, setPlayerOneWins] = useState(
    String(playerOne?.gameWins ?? 0),
  );
  const [playerTwoWins, setPlayerTwoWins] = useState(
    String(playerTwo?.gameWins ?? 0),
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!playerOne || !playerTwo) {
      return;
    }

    setBusy(true);
    try {
      await recordMatchResult({
        matchId: row.match._id,
        playerOneRegistrationId: playerOne.playerId,
        playerTwoRegistrationId: playerTwo.playerId,
        playerOneGameWins: Number.parseInt(playerOneWins, 10),
        playerTwoGameWins: Number.parseInt(playerTwoWins, 10),
      });
      onOpenChange(false);
      toast.success("Match result recorded.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not record the match result.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) {
          onOpenChange(nextOpen);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Enter match result</DialogTitle>
            <DialogDescription>
              Record the game wins for each player
              {row.match.tableNumber === undefined
                ? ""
                : ` at table ${row.match.tableNumber}`}
              .
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor={`player-one-wins-${row.match._id}`}>
                  {pairedPlayerName(playerOne)}
                </FieldLabel>
                <Input
                  id={`player-one-wins-${row.match._id}`}
                  value={playerOneWins}
                  onChange={(event) => setPlayerOneWins(event.target.value)}
                  type="number"
                  min={0}
                  max={2}
                  disabled={busy}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`player-two-wins-${row.match._id}`}>
                  {pairedPlayerName(playerTwo)}
                </FieldLabel>
                <Input
                  id={`player-two-wins-${row.match._id}`}
                  value={playerTwoWins}
                  onChange={(event) => setPlayerTwoWins(event.target.value)}
                  type="number"
                  min={0}
                  max={2}
                  disabled={busy}
                  required
                />
              </Field>
            </div>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              Save result
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
