
import { useState, type FormEvent } from "react";
import { useMutation } from "convex/react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@tournament-os/backend/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  FieldContent,
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
import {
  addTournamentCreationPhase,
  createDefaultTournamentCreationPhase,
  removeTournamentCreationPhase,
  toTournamentCreationPhasePayload,
  tournamentFormats,
  type TournamentCreationPhaseForm,
  type TournamentCreationPhaseRoundMode,
  type TournamentFormat,
} from "@tournament-os/core/tournament-creation-utils";
import { useOrganization } from "./organization-context";

export function CreateTournamentDialog() {
  const { selectedOrganizationId } = useOrganization();
  const createTournament = useMutation(
    api.tournaments.lifecycle.createTournamentWithPhases,
  );

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [startDateTime, setStartDateTime] = useState("");
  const [playerCapacity, setPlayerCapacity] = useState("32");
  const [format, setFormat] = useState<TournamentFormat>("standard");
  const [isTestEvent, setIsTestEvent] = useState(false);
  const [phases, setPhases] = useState<TournamentCreationPhaseForm[]>([
    createDefaultTournamentCreationPhase("phase-1"),
  ]);

  const disabled = !selectedOrganizationId || busy;

  function resetForm() {
    setName("");
    setStartDateTime("");
    setPlayerCapacity("32");
    setFormat("standard");
    setIsTestEvent(false);
    setPhases([createDefaultTournamentCreationPhase("phase-1")]);
  }

  function handleAddPhase() {
    setPhases((current) =>
      addTournamentCreationPhase(current, `phase-${Date.now()}`),
    );
  }

  function handleRemovePhase(id: string) {
    setPhases((current) => removeTournamentCreationPhase(current, id));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedOrganizationId) {
      return;
    }

    setBusy(true);
    try {
      await createTournament({
        organizationId: selectedOrganizationId,
        name,
        startDate: new Date(startDateTime).getTime(),
        playerCapacity: Number.parseInt(playerCapacity, 10),
        format,
        isTestEvent,
        phases: toTournamentCreationPhasePayload(phases),
      });
      resetForm();
      setOpen(false);
      toast.success("Tournament created.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not create tournament.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" disabled={!selectedOrganizationId}>
          <Plus data-icon="inline-start" />
          Create new tournament
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
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
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Store Championship"
                  disabled={disabled}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tournament-start">Start date</FieldLabel>
                <Input
                  id="tournament-start"
                  value={startDateTime}
                  onChange={(event) => setStartDateTime(event.target.value)}
                  type="datetime-local"
                  disabled={disabled}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tournament-capacity">Capacity</FieldLabel>
                <Input
                  id="tournament-capacity"
                  value={playerCapacity}
                  onChange={(event) => setPlayerCapacity(event.target.value)}
                  type="number"
                  min={2}
                  max={512}
                  disabled={disabled}
                  required
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="tournament-format">Format</FieldLabel>
              <Select
                value={format}
                onValueChange={(value) => setFormat(value as TournamentFormat)}
                disabled={disabled}
              >
                <SelectTrigger id="tournament-format" className="w-full capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {tournamentFormats.map((tournamentFormat) => (
                      <SelectItem
                        key={tournamentFormat}
                        value={tournamentFormat}
                        className="capitalize"
                      >
                        {tournamentFormat}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field orientation="horizontal" data-disabled={disabled}>
              <Checkbox
                id="tournament-test-event"
                checked={isTestEvent}
                onCheckedChange={(checked) => setIsTestEvent(checked === true)}
                disabled={disabled}
              />
              <FieldContent>
                <FieldLabel htmlFor="tournament-test-event">
                  Mark as test event
                </FieldLabel>
                <FieldDescription>
                  Use this for practice or setup testing.
                </FieldDescription>
              </FieldContent>
            </Field>

            <FieldSet>
              <FieldLegend>Swiss phases</FieldLegend>
              <FieldGroup>
                {phases.map((phase, index) => (
                  <TournamentPhaseField
                    key={phase.id}
                    disabled={disabled}
                    index={index}
                    onRemovePhase={handleRemovePhase}
                    onPhasesChange={setPhases}
                    phase={phase}
                    phases={phases}
                  />
                ))}
              </FieldGroup>
              <Button
                type="button"
                variant="outline"
                onClick={handleAddPhase}
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
              {busy ? <Spinner data-icon="inline-start" /> : null}
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
  onRemovePhase,
  onPhasesChange,
  phase,
  phases,
}: {
  disabled: boolean;
  index: number;
  onRemovePhase: (id: string) => void;
  onPhasesChange: (phases: TournamentCreationPhaseForm[]) => void;
  phase: TournamentCreationPhaseForm;
  phases: TournamentCreationPhaseForm[];
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
              onPhasesChange(
                phases.map((current) =>
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
              onPhasesChange(
                phases.map((current) =>
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
          onClick={() => onRemovePhase(phase.id)}
          disabled={disabled || phases.length === 1}
          aria-label={`Remove phase ${index + 1}`}
        >
          <Trash2 />
        </Button>
      </div>
    </Field>
  );
}
