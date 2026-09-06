import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Input,
  rpc,
  rpcMutate,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
} from "@roastery/ui";
import { formatMoney, humanize } from "@roastery/units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { describeApiFailure, retryLabelFor } from "@/lib/api-failure";

type Component = {
  id: string;
  kind: string;
  label: string | null;
  amount: string;
  currency: string;
  perUnit: boolean;
  amountBase: string;
  contractLineId: string | null;
};

type Draft = { key: string; kind: string; label: string; amount: string; perUnit: boolean };

/**
 * The lines behind a landed cost, and the ones a person may edit.
 *
 * Grouped by the bucket each kind rolls into, because that mapping is the
 * thing somebody needs and cannot guess: insurance and handling are freight,
 * storage and financing are carry, a differential is part of the price. A flat
 * list of sixteen kinds makes the reader learn the rollup by trial.
 *
 * Components carrying a `contractLineId` came from a contract receipt and are
 * shown but not editable. The price a coffee was bought at is a fact of the
 * purchase, and the API refuses to delete them for the same reason — so the
 * screen says why rather than leaving a row that mysteriously will not change.
 */
const KIND_GROUPS: { bucket: string; kinds: string[] }[] = [
  { bucket: "Price", kinds: ["base_price", "differential", "futures", "fx_adjustment"] },
  { bucket: "Freight", kinds: ["freight", "insurance", "handling"] },
  { bucket: "Duty", kinds: ["duty", "customs"] },
  { bucket: "Carry", kinds: ["carry", "storage", "financing"] },
  { bucket: "Other", kinds: ["broker_fee", "sampling", "certification", "other"] },
];

export function CostComponents({
  lotId,
  baseCurrency,
  canWrite,
}: {
  lotId: string;
  baseCurrency: string;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = React.useState<Draft[]>([]);
  const [draftsFor, setDraftsFor] = React.useState<string>();

  const components = useQuery({
    queryKey: ["inventory.green.listGreenLotCostComponents", lotId],
    queryFn: () =>
      rpc<{ items: Component[] }>("inventory.green.listGreenLotCostComponents", {
        greenLotId: lotId,
      }),
  });

  const fromContract = (components.data?.items ?? []).filter((c) => c.contractLineId !== null);
  const ownEntries = (components.data?.items ?? []).filter((c) => c.contractLineId === null);

  // Seeded during render and keyed on the lot, so switching lots cannot carry
  // one lot's edits onto another — the same rule the BOM editor learned.
  if (components.isSuccess && draftsFor !== lotId) {
    setDraftsFor(lotId);
    setDrafts(
      ownEntries.map((c) => ({
        key: c.id,
        kind: c.kind,
        label: c.label ?? "",
        amount: c.amount,
        perUnit: c.perUnit,
      })),
    );
  }

  const save = useMutation({
    mutationFn: () =>
      rpcMutate("inventory.green.setGreenLotCostComponents", {
        greenLotId: lotId,
        components: drafts.map((d) => ({
          kind: d.kind,
          ...(d.label.trim() ? { label: d.label.trim() } : {}),
          amount: d.amount.trim(),
          currency: baseCurrency,
          perUnit: d.perUnit,
        })),
      }),
    onSuccess: () => {
      toast.success("Costs recorded");
      void queryClient.invalidateQueries({
        queryKey: ["inventory.green.listGreenLotCostComponents"],
      });
      void queryClient.invalidateQueries({ queryKey: ["inventory.green.getGreenLotLandedCost"] });
    },
  });

  const isLoaded = draftsFor === lotId && !components.isError;
  const blockedBecause = !isLoaded
    ? "These costs have not loaded, so there is nothing safe to save."
    : drafts.some((d) => !d.amount.trim() || Number.isNaN(Number(d.amount)))
      ? "Every line needs an amount."
      : null;

  const failure = components.isError ? describeApiFailure(components.error, "these costs") : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">What made up this cost</CardTitle>
        <CardAction>
          {canWrite && isLoaded ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setDrafts((previous) => [
                  ...previous,
                  {
                    key: crypto.randomUUID(),
                    kind: "freight",
                    label: "",
                    amount: "",
                    perUnit: false,
                  },
                ])
              }
              disabled={drafts.length >= 50}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Add a line
            </Button>
          ) : null}
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {components.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : failure ? (
          <ErrorState
            title={failure.title}
            description={failure.description}
            correlationId={failure.correlationId}
            onRetry={() => void components.refetch()}
            retryLabel={retryLabelFor(failure.action)}
          />
        ) : (
          <>
            {fromContract.length > 0 ? (
              <div className="space-y-2">
                <p className="text-muted-foreground text-xs">
                  {/* Not editable, and the reason is the point: these describe
                      the purchase, and retyping them here would break the link
                      to the contract line they came from. */}
                  From the contract this lot arrived on. Change these by amending the contract, not
                  here.
                </p>
                <dl className="divide-y divide-border rounded-2xl border border-border">
                  {fromContract.map((component) => (
                    <div
                      key={component.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                    >
                      <dt className="min-w-0 flex-1 truncate">
                        {component.label ?? humanize(component.kind)}
                        <span className="ml-2 text-muted-foreground text-xs">
                          {humanize(component.kind)}
                          {component.perUnit ? " · per kg" : ""}
                        </span>
                      </dt>
                      <dd className="shrink-0 font-mono text-xs tabular-nums">
                        {formatMoney(component.amount, component.currency)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            {drafts.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {canWrite
                  ? "Nothing recorded by hand. Add freight, duty or storage as they are invoiced."
                  : "No costs have been recorded by hand for this lot."}
              </p>
            ) : (
              <div className="space-y-2">
                <div
                  aria-hidden="true"
                  className="flex items-center gap-2 text-muted-foreground text-xs"
                >
                  <span className="min-w-40 flex-1">Kind and note</span>
                  <span className="w-28 text-right">Amount</span>
                  <span className="w-24 text-center">Per kg</span>
                  <span className="w-9" />
                </div>
                {drafts.map((draft, index) => (
                  <div key={draft.key} className="flex flex-wrap items-center gap-2">
                    <div className="flex min-w-40 flex-1 gap-2">
                      <Select
                        value={draft.kind}
                        onValueChange={(kind) => update(setDrafts, draft.key, { kind })}
                        disabled={!canWrite}
                      >
                        <SelectTrigger
                          aria-label={`Kind for line ${index + 1}`}
                          className="w-40 shrink-0"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {KIND_GROUPS.map((group) => (
                            <SelectGroup key={group.bucket}>
                              {/* The bucket is the thing a person cannot guess:
                                  insurance is freight, storage is carry. */}
                              <SelectLabel>{group.bucket}</SelectLabel>
                              {group.kinds.map((kind) => (
                                <SelectItem key={kind} value={kind}>
                                  {humanize(kind)}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={draft.label}
                        onChange={(event) =>
                          update(setDrafts, draft.key, { label: event.target.value })
                        }
                        placeholder="Invoice or note"
                        maxLength={200}
                        aria-label={`Note for line ${index + 1}`}
                        disabled={!canWrite}
                      />
                    </div>
                    <Input
                      value={draft.amount}
                      onChange={(event) =>
                        update(setDrafts, draft.key, { amount: event.target.value })
                      }
                      inputMode="decimal"
                      className="w-28 text-right font-mono"
                      placeholder="0.0000"
                      aria-label={`Amount for line ${index + 1}`}
                      disabled={!canWrite}
                    />
                    <div className="flex w-24 justify-center">
                      <Switch
                        checked={draft.perUnit}
                        onCheckedChange={(perUnit) => update(setDrafts, draft.key, { perUnit })}
                        aria-label={`Line ${index + 1} is priced per kilogram`}
                        disabled={!canWrite}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        setDrafts((previous) => previous.filter((d) => d.key !== draft.key))
                      }
                      aria-label={`Remove line ${index + 1}`}
                      disabled={!canWrite}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <p className="pt-1 text-muted-foreground text-xs">
                  {/* A rate and a flat charge are different facts and the
                      rollup multiplies one of them by the lot's weight. */}
                  A per-kilogram line is a rate: the rollup multiplies it by the lot's opening
                  weight. Amounts are in {baseCurrency}.
                </p>
              </div>
            )}

            {canWrite ? (
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={() => save.mutate()}
                  disabled={blockedBecause !== null || save.isPending}
                >
                  Save these costs
                </Button>
                {blockedBecause ? (
                  <p className="text-muted-foreground text-xs">{blockedBecause}</p>
                ) : null}
                {save.error ? (
                  <p role="alert" className="text-destructive text-xs">
                    {describeApiFailure(save.error, "these costs").title}
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function update(
  setDrafts: React.Dispatch<React.SetStateAction<Draft[]>>,
  key: string,
  patch: Partial<Draft>,
) {
  setDrafts((previous) => previous.map((d) => (d.key === key ? { ...d, ...patch } : d)));
}
