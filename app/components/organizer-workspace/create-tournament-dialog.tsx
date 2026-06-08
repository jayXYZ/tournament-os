import type { FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type {
  TournamentCreationPhaseForm,
  TournamentCreationPhaseRoundMode,
} from "@/lib/tournament-creation-utils";
import type { BusyState } from "./types";

export function CreateTournamentDialog({
  busy,
  onAddTournamentPhase,
  onCreateTournament,
  onOpenChange,
  onRemoveTournamentPhase,
  onTournamentNameChange,
  onTournamentPhasesChange,
  onTournamentPlayerCapacityChange,
  onTournamentStartDateTimeChange,
  open,
  selectedOrganizationId,
  tournamentName,
  tournamentPhases,
  tournamentPlayerCapacity,
  tournamentStartDateTime,
}: {
  busy: BusyState;
  onAddTournamentPhase: () => void;
  onCreateTournament: (event: FormEvent<HTMLFormElement>) => void;
  onOpenChange: (open: boolean) => void;
  onRemoveTournamentPhase: (id: string) => void;
  onTournamentNameChange: (value: string) => void;
  onTournamentPhasesChange: (phases: TournamentCreationPhaseForm[]) => void;
  onTournamentPlayerCapacityChange: (value: string) => void;
  onTournamentStartDateTimeChange: (value: string) => void;
  open: boolean;
  selectedOrganizationId: Id<"organizations"> | null;
  tournamentName: string;
  tournamentPhases: TournamentCreationPhaseForm[];
  tournamentPlayerCapacity: string;
  tournamentStartDateTime: string;
}) {
  const disabled = !selectedOrganizationId || busy === "tournament";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" disabled={!selectedOrganizationId}>
          <Plus data-icon="inline-start" />
          Create new tournament
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={onCreateTournament} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create tournament</DialogTitle>
            <DialogDescription>
              Add the tournament details and Swiss phases.
            </DialogDescription>
          </DialogHeader>

          <FieldGroup>
            <div className="grid gap-4 md:grid-cols-[1.2fr_1fr_120px]">
              <Field>
                <FieldLabel htmlFor="tournament-name">Name</FieldLabel>
                <Input
                  id="tournament-name"
                  value={tournamentName}
                  onChange={(event) =>
                    onTournamentNameChange(event.target.value)
                  }
                  placeholder="Store Championship"
                  disabled={disabled}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tournament-start">Start date</FieldLabel>
                <Input
                  id="tournament-start"
                  value={tournamentStartDateTime}
                  onChange={(event) =>
                    onTournamentStartDateTimeChange(event.target.value)
                  }
                  type="datetime-local"
                  disabled={disabled}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tournament-capacity">Capacity</FieldLabel>
                <Input
                  id="tournament-capacity"
                  value={tournamentPlayerCapacity}
                  onChange={(event) =>
                    onTournamentPlayerCapacityChange(event.target.value)
                  }
                  type="number"
                  min={2}
                  max={512}
                  disabled={disabled}
                  required
                />
              </Field>
            </div>

            <FieldSet>
              <FieldLegend>Swiss phases</FieldLegend>
              <FieldGroup>
                {tournamentPhases.map((phase, index) => (
                  <TournamentPhaseField
                    key={phase.id}
                    disabled={disabled}
                    index={index}
                    onRemoveTournamentPhase={onRemoveTournamentPhase}
                    onTournamentPhasesChange={onTournamentPhasesChange}
                    phase={phase}
                    tournamentPhases={tournamentPhases}
                  />
                ))}
              </FieldGroup>
              <Button
                type="button"
                variant="outline"
                onClick={onAddTournamentPhase}
                disabled={disabled}
              >
                <Plus data-icon="inline-start" />
                Add Swiss phase
              </Button>
            </FieldSet>

            {!selectedOrganizationId && (
              <FieldDescription>
                Create or select an organization before creating tournaments.
              </FieldDescription>
            )}
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={disabled}>
              {busy === "tournament" ? (
                <Spinner data-icon="inline-start" />
              ) : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TournamentPhaseField({
  disabled,
  index,
  onRemoveTournamentPhase,
  onTournamentPhasesChange,
  phase,
  tournamentPhases,
}: {
  disabled: boolean;
  index: number;
  onRemoveTournamentPhase: (id: string) => void;
  onTournamentPhasesChange: (phases: TournamentCreationPhaseForm[]) => void;
  phase: TournamentCreationPhaseForm;
  tournamentPhases: TournamentCreationPhaseForm[];
}) {
  return (
    <Field className="rounded-md border border-border p-3">
      <div className="grid gap-3 md:grid-cols-[90px_1fr_120px_32px] md:items-end">
        <div className="flex flex-col gap-1">
          <FieldLabel>Phase {index + 1}</FieldLabel>
          <FieldDescription>Swiss</FieldDescription>
        </div>
        <Field>
          <FieldLabel>Rounds</FieldLabel>
          <Select
            value={phase.phaseRoundMode}
            onValueChange={(value) =>
              onTournamentPhasesChange(
                tournamentPhases.map((current) =>
                  current.id === phase.id
                    ? {
                        ...current,
                        phaseRoundMode:
                          value as TournamentCreationPhaseRoundMode,
                      }
                    : current,
                ),
              )
            }
            disabled={disabled}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="dynamic">Dynamic rounds</SelectItem>
                <SelectItem value="fixed">Fixed rounds</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${phase.id}-total-rounds`}>
            Total rounds
          </FieldLabel>
          <Input
            id={`${phase.id}-total-rounds`}
            value={phase.phaseTotalRounds}
            onChange={(event) =>
              onTournamentPhasesChange(
                tournamentPhases.map((current) =>
                  current.id === phase.id
                    ? { ...current, phaseTotalRounds: event.target.value }
                    : current,
                ),
              )
            }
            type="number"
            min={1}
            max={16}
            disabled={disabled || phase.phaseRoundMode === "dynamic"}
            required={phase.phaseRoundMode === "fixed"}
          />
        </Field>
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={() => onRemoveTournamentPhase(phase.id)}
          disabled={disabled || tournamentPhases.length === 1}
          aria-label={`Remove phase ${index + 1}`}
        >
          <Trash2 />
        </Button>
      </div>
    </Field>
  );
}
