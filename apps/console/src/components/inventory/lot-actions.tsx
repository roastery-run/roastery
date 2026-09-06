import {
  Button,
  ButtonGroup,
  Checkbox,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  rpc,
  rpcMutate,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@roastery/ui";
import { formatWeight, subtract } from "@roastery/units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeftRight, Merge, Scale, Split } from "lucide-react";
import * as React from "react";
import { LotActionDialog } from "@/components/inventory/lot-action-dialog";
import { ADJUST_REASONS, type AdjustReason, buildAdjustment, REASONS } from "@/lib/lot-adjustment";
import { useDebounced } from "@/lib/use-debounced";
import { useWorkspace } from "@/lib/workspace";

export type ActionableLot = {
  id: string;
  name: string;
  lotCode: string;
  status: string;
  currentWeightKg: string;
};

type Balance = { locationId: string; locationName: string; weightKg: string };

/**
 * Everything a person can do to a green lot, where they can see what it did.
 *
 * These live on the lot detail rather than in a row menu on purpose: each one
 * writes a ledger entry, and the ledger is directly below. The dialog closes,
 * the queries invalidate, and the new row arriving with its delta and its
 * resulting balance IS the confirmation. A toast saying "Adjusted" would be a
 * weaker claim about the same event, made further from the evidence.
 */
export function LotActions({ lot, canWrite }: { lot: ActionableLot; canWrite: boolean }) {
  const [open, setOpen] = React.useState<"adjust" | "transfer" | "split" | "merge" | null>(null);
  const { locations } = useWorkspace();

  if (!canWrite) return null;

  // A quarantined lot is not a lot you correct; it is a lot waiting on a
  // decision that belongs to quality. Offering four stock verbs against it
  // invites somebody to adjust their way around a failed grading.
  if (lot.status === "quarantined") return null;

  return (
    <>
      <ButtonGroup>
        <Button variant="outline" size="sm" onClick={() => setOpen("adjust")}>
          <Scale className="size-3.5" aria-hidden="true" />
          Adjust
        </Button>
        {/* Moving weight between one location is not a thing. */}
        {locations.length > 1 ? (
          <Button variant="outline" size="sm" onClick={() => setOpen("transfer")}>
            <ArrowLeftRight className="size-3.5" aria-hidden="true" />
            Transfer
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => setOpen("split")}>
          <Split className="size-3.5" aria-hidden="true" />
          Split
        </Button>
        <Button variant="outline" size="sm" onClick={() => setOpen("merge")}>
          <Merge className="size-3.5" aria-hidden="true" />
          Merge in
        </Button>
      </ButtonGroup>

      {open === "adjust" ? <AdjustDialog lot={lot} onClose={() => setOpen(null)} /> : null}
      {open === "transfer" ? (
        <TransferDialog lot={lot} locations={locations} onClose={() => setOpen(null)} />
      ) : null}
      {open === "split" ? <SplitDialog lot={lot} onClose={() => setOpen(null)} /> : null}
      {open === "merge" ? <MergeDialog lot={lot} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

/**
 * One mutation shape for all four.
 *
 * Every action invalidates the whole `inventory` key rather than a narrower
 * one: a split writes two lots, a merge writes up to twenty-one, and a
 * transfer changes balances the detail page does not name. Guessing which
 * queries a write touched is how a screen ends up showing a stale figure
 * beside a fresh one.
 */
function useLotAction(operation: string, onClose: () => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => rpcMutate(operation, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inventory.green.getGreenLot"] });
      void queryClient.invalidateQueries({
        queryKey: ["inventory.green.listGreenLotTransactions"],
      });
      void queryClient.invalidateQueries({ queryKey: ["inventory.green.listGreenLots"] });
      void queryClient.invalidateQueries({ queryKey: ["inventory.green.listGreenLotBalances"] });
      onClose();
    },
  });
}

export function AdjustDialog({ lot, onClose }: { lot: ActionableLot; onClose: () => void }) {
  const [reason, setReason] = React.useState<AdjustReason>("recount");
  const [amount, setAmount] = React.useState("");
  const [comment, setComment] = React.useState("");
  const action = useLotAction("inventory.green.adjustGreenLotQuantity", onClose);

  const meta = REASONS[reason];
  const result = buildAdjustment({ reason, amount, onHandKg: lot.currentWeightKg });
  const needsComment = meta.requiresComment && comment.trim() === "";

  const blockedBecause = !result.ok
    ? amount.trim() === ""
      ? "Enter a weight to continue."
      : result.problem
    : needsComment
      ? "This reason needs a note saying why."
      : null;

  const delta = result.ok ? result.deltaKg : null;
  const removing = delta?.startsWith("-") ?? false;

  return (
    <LotActionDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Adjust ${lot.name}`}
      description="The reason decides what the ledger records, and what this form asks you for."
      submitLabel={
        result.ok
          ? `${removing ? "Remove" : "Add"} ${formatWeight(stripSign(result.deltaKg), { unit: "kg" })}`
          : meta.label
      }
      destructive={reason === "write_off"}
      blockedBecause={blockedBecause}
      isPending={action.isPending}
      error={action.error}
      onSubmit={() =>
        result.ok &&
        action.mutate({
          id: lot.id,
          deltaKg: result.deltaKg,
          reason,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        })
      }
    >
      <Field>
        <FieldLabel htmlFor="adjust-reason">Reason</FieldLabel>
        <Select value={reason} onValueChange={(value) => setReason(value as AdjustReason)}>
          <SelectTrigger id="adjust-reason">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ADJUST_REASONS.map((key) => (
              <SelectItem key={key} value={key}>
                {REASONS[key].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FieldDescription className="text-xs">{meta.hint}</FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="adjust-amount">
          {meta.means === "counted"
            ? "Counted weight"
            : meta.means === "removed"
              ? "Weight removed"
              : meta.means === "added"
                ? "Weight returned"
                : "Change"}
        </FieldLabel>
        <Input
          id="adjust-amount"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          className="font-mono"
          placeholder={meta.means === "counted" ? lot.currentWeightKg : "0.0000"}
          autoFocus
        />
        <FieldDescription className="text-xs">
          {/* The whole point of the reason-first form: a recount is stated as a
              destination, and the person never has to work out the difference
              themselves. Showing it live is also how a fat-fingered decimal
              gets caught before it reaches the ledger. */}
          {result.ok ? (
            <>
              On hand {formatWeight(lot.currentWeightKg, { unit: "kg" })} →{" "}
              <span className="font-mono">{formatWeight(result.resultingKg, { unit: "kg" })}</span>{" "}
              <span className={removing ? "text-destructive" : "text-success"}>
                ({removing ? "" : "+"}
                {formatWeight(result.deltaKg, { unit: "kg" })})
              </span>
            </>
          ) : (
            <>Currently on hand: {formatWeight(lot.currentWeightKg, { unit: "kg" })}</>
          )}
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="adjust-comment">
          Note{" "}
          {meta.requiresComment ? "" : <span className="text-muted-foreground">(optional)</span>}
        </FieldLabel>
        <Textarea
          id="adjust-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          maxLength={1000}
          placeholder={
            reason === "sample_draw"
              ? "Which cupping or grading session"
              : reason === "write_off"
                ? "What happened to the coffee"
                : "Anything a reader will want later"
          }
        />
      </Field>
    </LotActionDialog>
  );
}

export function TransferDialog({
  lot,
  locations,
  onClose,
}: {
  lot: ActionableLot;
  locations: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const [weight, setWeight] = React.useState("");
  const [comment, setComment] = React.useState("");
  const action = useLotAction("inventory.green.transferGreenLotToLocation", onClose);

  const balances = useQuery({
    queryKey: ["inventory.green.listGreenLotBalances", lot.id],
    queryFn: () =>
      rpc<{ items: Balance[] }>("inventory.green.listGreenLotBalances", { id: lot.id }),
  });

  // Only somewhere the coffee actually is. Offering an empty location as a
  // source produces a request the API rejects for a reason the form knew.
  const sources = (balances.data?.items ?? []).filter(
    (balance) => Number.parseFloat(balance.weightKg) > 0,
  );
  const available = sources.find((balance) => balance.locationId === from)?.weightKg ?? "0";
  const parsed = Number.parseFloat(weight);

  const blockedBecause = balances.isLoading
    ? "Loading where this lot is held."
    : sources.length === 0
      ? "This lot is not recorded at any location."
      : !from
        ? "Choose where the coffee is now."
        : !to
          ? "Choose where it is going."
          : !weight.trim() || Number.isNaN(parsed) || parsed <= 0
            ? "Enter a weight above zero."
            : parsed > Number.parseFloat(available)
              ? `Only ${formatWeight(available, { unit: "kg" })} is held there.`
              : null;

  return (
    <LotActionDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Move ${lot.name}`}
      description="Weight moves between locations. The lot, and its total, stay the same."
      submitLabel={
        to
          ? `Move to ${locations.find((location) => location.id === to)?.name ?? "location"}`
          : "Move"
      }
      blockedBecause={blockedBecause}
      isPending={action.isPending}
      error={action.error}
      onSubmit={() =>
        action.mutate({
          id: lot.id,
          fromLocationId: from,
          toLocationId: to,
          weightKg: weight.trim(),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        })
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="transfer-from">From</FieldLabel>
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger id="transfer-from">
              <SelectValue placeholder="Where it is now" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((balance) => (
                <SelectItem key={balance.locationId} value={balance.locationId}>
                  {balance.locationName} · {formatWeight(balance.weightKg, { unit: "kg" })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field>
          <FieldLabel htmlFor="transfer-to">To</FieldLabel>
          <Select value={to} onValueChange={setTo}>
            <SelectTrigger id="transfer-to">
              <SelectValue placeholder="Where it is going" />
            </SelectTrigger>
            <SelectContent>
              {locations
                .filter((location) => location.id !== from)
                .map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="transfer-weight">Weight</FieldLabel>
        <Input
          id="transfer-weight"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          inputMode="decimal"
          className="font-mono"
          placeholder="0.0000"
        />
        <FieldDescription className="text-xs">
          {from ? (
            <>
              {formatWeight(available, { unit: "kg" })} held there.{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => setWeight(available)}
              >
                Move all of it
              </button>
            </>
          ) : (
            "Choose a source to see what is held there."
          )}
        </FieldDescription>
      </Field>

      <Field>
        <FieldLabel htmlFor="transfer-comment">
          Note <span className="text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Textarea
          id="transfer-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          maxLength={1000}
        />
      </Field>
    </LotActionDialog>
  );
}

export function SplitDialog({ lot, onClose }: { lot: ActionableLot; onClose: () => void }) {
  // The API requires a code and rejects a duplicate with a field error, so a
  // suffix is a starting point rather than a guarantee. Better than a blank
  // required field on a form somebody opens twice a year.
  const [code, setCode] = React.useState(`${lot.lotCode}-A`);
  const [name, setName] = React.useState("");
  const [weight, setWeight] = React.useState("");
  const [comment, setComment] = React.useState("");
  const action = useLotAction("inventory.green.splitGreenLot", onClose);

  const parsed = Number.parseFloat(weight);
  const onHand = Number.parseFloat(lot.currentWeightKg);

  const blockedBecause = !code.trim()
    ? "The new lot needs a code."
    : !weight.trim() || Number.isNaN(parsed) || parsed <= 0
      ? "Enter a weight above zero."
      : parsed >= onHand
        ? `Splitting out all ${formatWeight(lot.currentWeightKg, { unit: "kg" })} would leave nothing behind. Rename the lot instead.`
        : null;

  return (
    <LotActionDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Split ${lot.name}`}
      description="Weight moves out into a new lot with its own code, keeping this lot's provenance."
      submitLabel={
        Number.isFinite(parsed) && parsed > 0
          ? `Split out ${formatWeight(weight.trim(), { unit: "kg" })}`
          : "Split"
      }
      blockedBecause={blockedBecause}
      isPending={action.isPending}
      error={action.error}
      onSubmit={() =>
        action.mutate({
          id: lot.id,
          weightKg: weight.trim(),
          newLotCode: code.trim(),
          ...(name.trim() ? { newName: name.trim() } : {}),
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        })
      }
    >
      <Field>
        <FieldLabel htmlFor="split-weight">Weight to split out</FieldLabel>
        <Input
          id="split-weight"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          inputMode="decimal"
          className="font-mono"
          placeholder="0.0000"
          autoFocus
        />
        <FieldDescription className="text-xs">
          {Number.isFinite(parsed) && parsed > 0 && parsed < onHand ? (
            <>
              Leaves{" "}
              <span className="font-mono">
                {/* Exact, not `onHand - parsed`: this is a weight on the screen
                    that decides how a lot is divided, and CLAUDE.md §3 exists
                    because a float is where an auditable figure stops being
                    one. */}
                {formatWeight(subtract(lot.currentWeightKg, weight.trim()), { unit: "kg" })}
              </span>{" "}
              in {lot.lotCode}.
            </>
          ) : (
            <>On hand: {formatWeight(lot.currentWeightKg, { unit: "kg" })}</>
          )}
        </FieldDescription>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="split-code">New lot code</FieldLabel>
          <Input
            id="split-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className="font-mono"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="split-name">
            New name <span className="text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Input
            id="split-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={lot.name}
          />
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="split-comment">
          Note <span className="text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Textarea
          id="split-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          maxLength={1000}
        />
      </Field>
    </LotActionDialog>
  );
}

export function MergeDialog({ lot, onClose }: { lot: ActionableLot; onClose: () => void }) {
  const [sourceIds, setSourceIds] = React.useState<string[]>([]);
  const [term, setTerm] = React.useState("");
  const [comment, setComment] = React.useState("");
  const action = useLotAction("inventory.green.mergeGreenLots", onClose);

  // Searched on the server like every other picker: two hundred checkboxes
  // with no way to find one is not a choice, it is a haystack — and on a large
  // tenant the lot somebody wants is usually not in the first two hundred.
  const search = useDebounced(term, 250);
  const lots = useQuery({
    queryKey: ["inventory.green.listGreenLots", "merge", search],
    queryFn: () =>
      rpc<{ items: ActionableLot[] }>("inventory.green.listGreenLots", {
        filter: { status: "available", ...(search ? { q: search } : {}) },
        page: { limit: 50 },
      }),
  });

  const candidates = (lots.data?.items ?? []).filter((candidate) => candidate.id !== lot.id);
  // Chosen lots survive a search that no longer returns them: unticking
  // something by typing is not a thing a person expects a search box to do.
  const chosen = React.useRef(new Map<string, ActionableLot>());
  for (const candidate of candidates) {
    if (sourceIds.includes(candidate.id)) chosen.current.set(candidate.id, candidate);
  }
  const selectedLots = sourceIds
    .map((id) => chosen.current.get(id))
    .filter((entry): entry is ActionableLot => entry !== undefined);

  const blockedBecause = lots.isLoading
    ? "Loading the other lots."
    : sourceIds.length === 0
      ? candidates.length === 0 && term === ""
        ? "There is no other available lot to merge in."
        : "Choose at least one lot to absorb."
      : null;

  return (
    <LotActionDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={`Merge into ${lot.name}`}
      description={
        <>
          The lots you choose are absorbed into this one, which keeps its code and its provenance.
          Their ledgers close, and their weight arrives here as a movement. This cannot be undone.
        </>
      }
      submitLabel={
        sourceIds.length > 0
          ? `Merge ${sourceIds.length} lot${sourceIds.length === 1 ? "" : "s"} into ${lot.lotCode}`
          : "Merge"
      }
      destructive
      blockedBecause={blockedBecause}
      isPending={action.isPending}
      error={action.error}
      onSubmit={() =>
        action.mutate({
          targetId: lot.id,
          sourceIds,
          ...(comment.trim() ? { comment: comment.trim() } : {}),
        })
      }
    >
      <Input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Search lots by name or code"
        aria-label="Search lots to absorb"
        autoComplete="off"
        spellCheck={false}
      />

      {selectedLots.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          {/* The count is stated because the chosen lots may not all be on
              screen once a search narrows the list. */}
          {selectedLots.length} chosen: {selectedLots.map((entry) => entry.lotCode).join(", ")}
        </p>
      ) : null}

      <fieldset className="max-h-64 space-y-1 overflow-y-auto rounded-2xl border border-border p-2">
        <legend className="sr-only">Lots to absorb</legend>
        {/* The cap prevented the error and never explained it: at twenty, every
            remaining checkbox simply went dead. */}
        {sourceIds.length >= 20 ? (
          <p className="px-2 py-1.5 text-muted-foreground text-xs">
            Twenty lots is the most one merge can absorb. Clear one to choose another.
          </p>
        ) : null}
        {!lots.isLoading && candidates.length === 0 ? (
          <p className="px-2 py-1.5 text-muted-foreground text-sm">
            {term ? "No available lot matches that." : "There is no other available lot."}
          </p>
        ) : null}
        {candidates.map((candidate) => {
          const checked = sourceIds.includes(candidate.id);
          return (
            <div
              key={candidate.id}
              className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-muted"
            >
              <Checkbox
                id={`merge-${candidate.id}`}
                checked={checked}
                // Twenty is the API's cap, so the form stops there rather than
                // letting somebody select thirty and be told afterwards.
                disabled={!checked && sourceIds.length >= 20}
                onCheckedChange={(next) =>
                  setSourceIds((previous) =>
                    next
                      ? [...previous, candidate.id]
                      : previous.filter((id) => id !== candidate.id),
                  )
                }
              />
              {/* The whole row is the target: a 16px checkbox is not something
                  to aim at twenty times during a count. */}
              <label
                htmlFor={`merge-${candidate.id}`}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
              >
                <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                <span className="shrink-0 font-mono text-muted-foreground text-xs">
                  {candidate.lotCode}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums">
                  {formatWeight(candidate.currentWeightKg, { unit: "kg" })}
                </span>
              </label>
            </div>
          );
        })}
      </fieldset>

      <Field>
        <FieldLabel htmlFor="merge-comment">
          Note <span className="text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Textarea
          id="merge-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Why these lots are being combined"
        />
      </Field>
    </LotActionDialog>
  );
}

function stripSign(value: string): string {
  return value.startsWith("-") ? value.slice(1) : value;
}
