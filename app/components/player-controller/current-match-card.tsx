"use client";

import { useState } from "react";
import {
  useConfirmResult,
  type MyActiveMatch,
  type MyCurrentMatch,
} from "@tournament-os/core";
import { CheckCheck, Hourglass, Swords } from "lucide-react";
import { toast } from "sonner";

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
import { Spinner } from "@/components/ui/spinner";

import { ReportResultDialog } from "./report-result-dialog";

export function CurrentMatchCard({
  currentMatch,
}: {
  currentMatch: MyCurrentMatch | undefined;
}) {
  if (currentMatch === undefined) {
    return <Skeleton className="h-56" />;
  }

  if (currentMatch.kind === "not_started") {
    return (
      <StatusEmpty
        icon={Hourglass}
        title="Waiting for round one"
        description="Pairings will appear here as soon as the organizer starts the tournament."
      />
    );
  }

  if (currentMatch.kind === "between_rounds") {
    return (
      <StatusEmpty
        icon={Hourglass}
        title={`Round ${currentMatch.round.roundNumber} complete`}
        description={
          currentMatch.round.isFinalRound
            ? "That was the final round. Check the standings tab for the final results."
            : "Hang tight — the organizer is preparing the next round's pairings."
        }
      />
    );
  }

  if (currentMatch.kind === "no_match") {
    return (
      <StatusEmpty
        icon={Swords}
        title="No match this round"
        description={
          currentMatch.myRegistrationStatus === "dropped"
            ? "You have dropped from this tournament, so you are no longer paired."
            : "You are not paired this round."
        }
      />
    );
  }

  return <ActiveMatch currentMatch={currentMatch} />;
}

function ActiveMatch({ currentMatch }: { currentMatch: MyActiveMatch }) {
  const { match, me, opponent, round } = currentMatch;
  const opponentName = opponent?.name ?? "your opponent";

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          {round.roundName}
          {round.isFinalRound ? " · Final round" : ""}
        </CardDescription>
        <CardTitle className="text-2xl">
          {me.isBye ? (
            "You have a bye"
          ) : (
            <>
              Table {match.tableNumber ?? "—"}
              <span className="block text-base font-normal text-muted-foreground">
                vs {opponentName}
              </span>
            </>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <MatchStatusSection currentMatch={currentMatch} />
      </CardContent>
    </Card>
  );
}

function MatchStatusSection({ currentMatch }: { currentMatch: MyActiveMatch }) {
  const { match, me, opponent } = currentMatch;
  const confirmResult = useConfirmResult();
  const [reporting, setReporting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (me.isBye) {
    return (
      <p className="text-sm text-muted-foreground">
        You receive an automatic match win this round. Sit back and enjoy the
        break.
      </p>
    );
  }

  if (match.matchStatus === "upcoming") {
    return (
      <>
        <p className="text-sm text-muted-foreground">
          Play your match, then report the result here. Either player can
          report.
        </p>
        <Button type="button" size="lg" onClick={() => setReporting(true)}>
          Report result
        </Button>
        {reporting ? (
          <ReportResultDialog
            matchId={match._id}
            opponentName={opponentName(currentMatch)}
            open={reporting}
            onOpenChange={setReporting}
          />
        ) : null}
      </>
    );
  }

  const scoreline = formatScoreline(me.gameWins, me.gameLosses);
  const reportedByMe = match.reportedByRegistrationId === me.registrationId;

  if (match.matchStatus === "confirmed") {
    return (
      <ResultSummary
        scoreline={scoreline}
        badge={
          <Badge>
            <CheckCheck data-icon="inline-start" />
            Confirmed
          </Badge>
        }
      />
    );
  }

  if (match.matchStatus === "completed" && match.reportedByRegistrationId) {
    if (reportedByMe) {
      return (
        <ResultSummary
          scoreline={scoreline}
          badge={<Badge variant="outline">Waiting for confirmation</Badge>}
          note={`Waiting for ${opponent?.name ?? "your opponent"} to confirm. The round can continue without it.`}
        />
      );
    }

    return (
      <ResultSummary
        scoreline={scoreline}
        badge={<Badge variant="outline">Reported by opponent</Badge>}
        note="Result wrong? Find a judge or the tournament organizer."
      >
        <Button
          type="button"
          size="lg"
          disabled={confirming}
          onClick={async () => {
            setConfirming(true);
            try {
              await confirmResult({ matchId: match._id });
              toast.success("Result confirmed.");
            } catch (error) {
              toast.error(
                error instanceof Error
                  ? error.message
                  : "Could not confirm the result.",
              );
            } finally {
              setConfirming(false);
            }
          }}
        >
          {confirming ? <Spinner data-icon="inline-start" /> : null}
          Confirm result
        </Button>
      </ResultSummary>
    );
  }

  // Completed without a reporting player: the organizer entered it.
  return (
    <ResultSummary
      scoreline={scoreline}
      badge={<Badge variant="secondary">Recorded by organizer</Badge>}
    />
  );
}

function ResultSummary({
  scoreline,
  badge,
  note,
  children,
}: {
  scoreline: string;
  badge: React.ReactNode;
  note?: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xl font-semibold">{scoreline}</p>
        {badge}
      </div>
      {note ? <p className="text-sm text-muted-foreground">{note}</p> : null}
      {children}
    </>
  );
}

function StatusEmpty({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Swords;
  title: string;
  description: string;
}) {
  return (
    <Empty className="min-h-60 border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function opponentName(currentMatch: MyActiveMatch) {
  return currentMatch.opponent?.name ?? "Opponent";
}

function formatScoreline(
  gameWins: number | null,
  gameLosses: number | null,
) {
  const wins = gameWins ?? 0;
  const losses = gameLosses ?? 0;
  if (wins > losses) {
    return `You win ${wins}–${losses}`;
  }
  if (wins < losses) {
    return `You lose ${wins}–${losses}`;
  }
  return `Draw ${wins}–${losses}`;
}
