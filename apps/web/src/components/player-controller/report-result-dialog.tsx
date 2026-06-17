
import { useState } from "react";
import { useReportResult } from "@tournament-os/core";
import { Minus, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { Id } from "@tournament-os/backend/convex/_generated/dataModel";

export function ReportResultDialog({
  matchId,
  opponentName,
  open,
  onOpenChange,
}: {
  matchId: Id<"tournamentMatches">;
  opponentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const reportResult = useReportResult();
  const [busy, setBusy] = useState(false);
  const [myGameWins, setMyGameWins] = useState(0);
  const [opponentGameWins, setOpponentGameWins] = useState(0);

  async function handleSubmit() {
    setBusy(true);
    try {
      await reportResult({ matchId, myGameWins, opponentGameWins });
      onOpenChange(false);
      toast.success("Result reported.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not report the result.",
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
        <DialogHeader>
          <DialogTitle>Report match result</DialogTitle>
          <DialogDescription>
            Enter the games each player won. Your opponent will be asked to
            confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <GameWinsStepper
            label="You"
            value={myGameWins}
            onChange={setMyGameWins}
            disabled={busy}
          />
          <GameWinsStepper
            label={opponentName}
            value={opponentGameWins}
            onChange={setOpponentGameWins}
            disabled={busy}
          />
          <p className="text-center text-sm font-medium text-muted-foreground">
            {resultPreview(myGameWins, opponentGameWins, opponentName)}
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            size="lg"
            disabled={busy}
            onClick={() => void handleSubmit()}
          >
            {busy ? <Spinner data-icon="inline-start" /> : null}
            Submit result
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GameWinsStepper({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <p className="min-w-0 truncate text-sm font-medium">{label}</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`Fewer game wins for ${label}`}
          disabled={disabled || value <= 0}
          onClick={() => onChange(value - 1)}
        >
          <Minus />
        </Button>
        <span className="w-6 text-center text-lg font-semibold tabular-nums">
          {value}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`More game wins for ${label}`}
          disabled={disabled || value >= 2}
          onClick={() => onChange(value + 1)}
        >
          <Plus />
        </Button>
      </div>
    </div>
  );
}

function resultPreview(
  myGameWins: number,
  opponentGameWins: number,
  opponentName: string,
) {
  if (myGameWins > opponentGameWins) {
    return `You win ${myGameWins}–${opponentGameWins}`;
  }
  if (myGameWins < opponentGameWins) {
    return `${opponentName} wins ${opponentGameWins}–${myGameWins}`;
  }
  return `Draw ${myGameWins}–${opponentGameWins}`;
}
