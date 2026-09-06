import {
  ApiError,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
  rpcMutate,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@roastery/ui";
import { formatWeight, humanize, parseDecimal } from "@roastery/units";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { toast } from "sonner";
import { describeApiFailure } from "@/lib/api-failure";
import { useWorkspace } from "@/lib/workspace";

/**
 * Bringing a lot into inventory by hand.
 *
 * The ordinary path is a contract receipt, which creates the lot from the
 * shipment it arrived on. This is the other one: a spot purchase, a sample
 * bag, or the first day on the system when there is no contract behind
 * anything yet.
 *
 * A page rather than a dialog because `importGreenLotInput` has nineteen
 * fields. What keeps it from reading as a legacy ERP form is the split: four
 * fields are needed and the rest are not, so the required ones stand alone and
 * everything else sits behind a heading that says it can be left alone.
 */
export const Route = createFileRoute("/_app/inventory/import")({
  component: ImportLot,
});

const STATES = ["green", "parchment", "dry_cherry", "wet_parchment", "raw_green", "decaf_green"];

/**
 * A required field says so on the field.
 *
 * Three of twelve inputs here are required, and the only signal was
 * `blockedBecause` under the submit button naming one blocker at a time — a
 * guessing game played one field per attempt.
 */
function RequiredMark() {
  return (
    <span className="text-destructive" title="Required">
      <span aria-hidden="true">*</span>
      <span className="sr-only">(required)</span>
    </span>
  );
}

function ImportLot() {
  const navigate = useNavigate();
  const { can, locations, locationId } = useWorkspace();

  const [name, setName] = React.useState("");
  const [lotCode, setLotCode] = React.useState("");
  const [weightKg, setWeightKg] = React.useState("");
  const [state, setState] = React.useState("green");
  const [location, setLocation] = React.useState(locationId ?? "");
  const [supplierRef, setSupplierRef] = React.useState("");
  const [processMethod, setProcessMethod] = React.useState("");
  const [harvestYear, setHarvestYear] = React.useState("");
  const [varieties, setVarieties] = React.useState("");
  const [bagWeightKg, setBagWeightKg] = React.useState("");
  const [minWeightKg, setMinWeightKg] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const create = useMutation({
    mutationFn: () =>
      rpcMutate<{ id: string }>("inventory.green.importGreenLot", {
        name: name.trim(),
        lotCode: lotCode.trim(),
        weightKg: parseDecimal(weightKg) ?? "0",
        state,
        ...(location ? { locationId: location } : {}),
        ...(supplierRef.trim() ? { supplierRef: supplierRef.trim() } : {}),
        ...(processMethod.trim() ? { processMethod: processMethod.trim() } : {}),
        ...(harvestYear.trim() ? { harvestYear: Number(harvestYear) } : {}),
        ...(varieties.trim()
          ? {
              varieties: varieties
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            }
          : {}),
        ...(bagWeightKg.trim() ? { bagWeightKg: parseDecimal(bagWeightKg) ?? undefined } : {}),
        ...(minWeightKg.trim() ? { minWeightKg: parseDecimal(minWeightKg) ?? undefined } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    onSuccess: (lot) => {
      toast.success(`${name.trim()} is in inventory`);
      // Straight to the lot, not back to the list: the ledger's opening entry
      // is the proof the import worked, and it is on that page.
      void navigate({ to: "/inventory/$lotId", params: { lotId: lot.id } });
    },
  });

  // The most likely failure on this form is a duplicate lot code, which the
  // field description warns about — and it was surfacing as a generic block in
  // the right rail, as far from the input as the layout allows.
  const fieldErrors = create.error instanceof ApiError ? create.error.fields : {};

  const parsedWeight = parseDecimal(weightKg);
  const blockedBecause = !name.trim()
    ? "The lot needs a name."
    : !lotCode.trim()
      ? "The lot needs a code."
      : parsedWeight === null || Number.parseFloat(parsedWeight) <= 0
        ? "Enter the weight received, above zero."
        : null;

  if (!can("inventory.green.write")) {
    return (
      <ErrorState
        title="You do not have permission to import a lot"
        description="Ask an owner or an admin to grant it on your role, then reload."
      />
    );
  }

  const failure = create.error ? describeApiFailure(create.error, "this lot") : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import a lot"
        description="For coffee that did not arrive on a contract shipment: a spot purchase, a sample, or an opening balance."
        actions={
          <Button variant="outline" size="sm" onClick={() => void navigate({ to: "/inventory" })}>
            Cancel
          </Button>
        }
      />

      <form
        className="grid gap-4 lg:grid-cols-[1fr_20rem]"
        onSubmit={(event) => {
          event.preventDefault();
          if (blockedBecause || create.isPending) return;
          create.mutate();
        }}
      >
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">What arrived</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="import-name">
                    Name <RequiredMark />
                  </FieldLabel>
                  <Input
                    id="import-name"
                    aria-invalid={Boolean(fieldErrors.name)}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Huila Washed"
                    maxLength={200}
                  />
                  {fieldErrors.name ? <FieldError>{fieldErrors.name}</FieldError> : null}
                </Field>
                <Field>
                  <FieldLabel htmlFor="import-code">
                    Lot code <RequiredMark />
                  </FieldLabel>
                  <Input
                    id="import-code"
                    aria-invalid={Boolean(fieldErrors.lotCode)}
                    value={lotCode}
                    onChange={(event) => setLotCode(event.target.value)}
                    className="font-mono"
                    placeholder="COL-2026-01"
                  />
                  <FieldDescription className="text-xs">
                    Yours, not the exporter's. It has to be unique.
                  </FieldDescription>
                  {fieldErrors.lotCode ? <FieldError>{fieldErrors.lotCode}</FieldError> : null}
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="import-weight">
                    Weight received <RequiredMark />
                  </FieldLabel>
                  <Input
                    id="import-weight"
                    aria-invalid={Boolean(fieldErrors.weightKg)}
                    value={weightKg}
                    onChange={(event) => setWeightKg(event.target.value)}
                    inputMode="decimal"
                    className="font-mono"
                    placeholder="0.0000"
                  />
                  <FieldDescription className="text-xs">
                    {/* Bags are not a mass unit: the factor lives on the lot,
                        so this field is kilograms and the bag weight below is
                        what makes "275 bags" mean anything. */}
                    In kilograms. This becomes the lot's opening balance and the first ledger entry.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="import-state">State</FieldLabel>
                  <Select value={state} onValueChange={setState}>
                    <SelectTrigger id="import-state">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STATES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {humanize(value)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              {locations.length > 0 ? (
                <Field>
                  <FieldLabel htmlFor="import-location">Location</FieldLabel>
                  <Select value={location} onValueChange={setLocation}>
                    <SelectTrigger id="import-location">
                      <SelectValue placeholder="Where it is being held" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                What you know about it{" "}
                <span className="font-normal text-muted-foreground text-xs">
                  — all optional, and addable later
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="import-supplier">Supplier reference</FieldLabel>
                  <Input
                    id="import-supplier"
                    value={supplierRef}
                    onChange={(event) => setSupplierRef(event.target.value)}
                    maxLength={120}
                    placeholder="Their invoice or lot number"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="import-process">Process</FieldLabel>
                  <Input
                    id="import-process"
                    value={processMethod}
                    onChange={(event) => setProcessMethod(event.target.value)}
                    maxLength={80}
                    placeholder="Washed"
                  />
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="import-harvest">Harvest year</FieldLabel>
                  <Input
                    id="import-harvest"
                    value={harvestYear}
                    onChange={(event) => setHarvestYear(event.target.value)}
                    inputMode="numeric"
                    className="font-mono"
                    placeholder="2026"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="import-varieties">Varieties</FieldLabel>
                  <Input
                    id="import-varieties"
                    value={varieties}
                    onChange={(event) => setVarieties(event.target.value)}
                    placeholder="Caturra, Castillo"
                  />
                  <FieldDescription className="text-xs">Separated by commas.</FieldDescription>
                </Field>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="import-bag">Bag weight</FieldLabel>
                  <Input
                    id="import-bag"
                    value={bagWeightKg}
                    onChange={(event) => setBagWeightKg(event.target.value)}
                    inputMode="decimal"
                    className="font-mono"
                    placeholder="69"
                  />
                  <FieldDescription className="text-xs">
                    {/* Without this the lot simply has no bag count, which is
                        the honest answer. A default would misreport a
                        Colombian lot against a Brazilian one by 15%. */}
                    What one bag of this lot weighs, in kilograms. Set it and this lot can be
                    counted in bags; leave it and it is counted in kilograms only.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="import-min">Reorder point</FieldLabel>
                  <Input
                    id="import-min"
                    value={minWeightKg}
                    onChange={(event) => setMinWeightKg(event.target.value)}
                    inputMode="decimal"
                    className="font-mono"
                    placeholder="0.0000"
                  />
                  <FieldDescription className="text-xs">
                    Alerts when the lot falls to this weight.
                  </FieldDescription>
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="import-notes">Notes</FieldLabel>
                <Textarea
                  id="import-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  rows={3}
                  maxLength={4000}
                />
              </Field>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={blockedBecause !== null || create.isPending}
          >
            {parsedWeight && Number.parseFloat(parsedWeight) > 0
              ? `Import ${formatWeight(parsedWeight, { unit: "kg" })}`
              : "Import lot"}
          </Button>
          {blockedBecause ? (
            <p className="text-center text-muted-foreground text-xs">{blockedBecause}</p>
          ) : null}

          {/* Only what could not be shown beside a field. A validation failure
              is already rendered under the input that caused it. */}
          {failure && Object.keys(fieldErrors).length === 0 ? (
            <ErrorState
              title={failure.title}
              description={failure.description}
              correlationId={failure.correlationId}
              onRetry={() => create.mutate()}
            />
          ) : null}
        </aside>
      </form>
    </div>
  );
}
