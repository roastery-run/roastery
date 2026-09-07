import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  ErrorState,
  Metric,
  PageHeader,
  rpc,
  Skeleton,
} from "@roastery/ui";
import { formatMoney, formatWeight } from "@roastery/units";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Coins } from "lucide-react";
import { z } from "zod";
import { CostComponents } from "@/components/inventory/cost-components";
import { describeApiFailure, retryLabelFor } from "@/lib/api-failure";
import { useWorkspace } from "@/lib/workspace";

/**
 * Landed cost, one lot at a time.
 *
 * Master and detail rather than a table of every lot, because the API exposes
 * landed cost per lot — and that is the right shape: the cost is a rollup of
 * that lot's own components, and a table of totals would hide the breakdown
 * that explains them.
 *
 * The rollup carries base-currency amounts and nothing else, so the currency
 * comes from the ORGANIZATION, not from the lot. `greenLots.currency` is the
 * currency the coffee was BOUGHT in; every `*Base` figure here has already been
 * converted into the books' currency at the rate recorded when the cost was
 * entered. Labelling one with the other made a EUR-bought lot and a USD-bought
 * lot render in different, wrong currencies on a screen whose entire purpose is
 * comparing them.
 *
 * The opening weight does come from the lot: costing divides by the initial
 * weight, not by whatever is left.
 */
export const Route = createFileRoute("/_app/inventory/costs")({
  validateSearch: z.object({ lotId: z.string().optional().catch(undefined) }),
  component: LandedCosts,
});

type GreenLot = {
  id: string;
  name: string;
  lotCode: string;
  initialWeightKg: string;
};

/** Exactly what `inventory.green.getGreenLotLandedCost` returns. */
type LandedCost = {
  greenLotId: string;
  basePriceBase: string;
  freightBase: string;
  dutyBase: string;
  carryBase: string;
  otherBase: string;
  totalBase: string;
  perKgBase: string;
};

/**
 * The buckets a roaster reasons in, in the order they are incurred.
 *
 * Price, then what it took to get it here, then what the state took, then what
 * the money cost while it sat. Alphabetical or largest-first would both hide
 * that sequence, which is the thing that explains the total.
 */
const BUCKETS = [
  { key: "basePriceBase", label: "Price" },
  { key: "freightBase", label: "Freight" },
  { key: "dutyBase", label: "Duty" },
  { key: "carryBase", label: "Carry" },
  { key: "otherBase", label: "Other" },
] as const satisfies ReadonlyArray<{ key: keyof LandedCost; label: string }>;

function LandedCosts() {
  const { lotId } = Route.useSearch();
  const navigate = useNavigate();
  const { baseCurrency, can } = useWorkspace();

  const lots = useQuery({
    queryKey: ["inventory.green.listGreenLots", "costs"],
    queryFn: () =>
      rpc<{ items: GreenLot[] }>("inventory.green.listGreenLots", { page: { limit: 100 } }),
  });

  const items = lots.data?.items ?? [];
  const selected = lotId ?? items[0]?.id;
  const selectedLot = items.find((lot) => lot.id === selected);

  const cost = useQuery({
    queryKey: ["inventory.green.getGreenLotLandedCost", selected],
    queryFn: () =>
      rpc<LandedCost>("inventory.green.getGreenLotLandedCost", { greenLotId: selected }),
    enabled: Boolean(selected),
  });

  // The API derives a rollup for a lot that has never been costed rather than
  // 404ing, so there is no "no cost recorded" state to render: either the
  // figures arrived, or the read failed and must say so.
  const failure = cost.isError ? describeApiFailure(cost.error, "this lot's costs") : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Landed costs"
        description="What a lot actually cost, once freight, duty and financing are counted."
      />

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Lots</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {lots.isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : lots.isError ? (
              <ErrorState
                title={describeApiFailure(lots.error, "the lot list").title}
                description={describeApiFailure(lots.error, "the lot list").description}
                correlationId={describeApiFailure(lots.error, "the lot list").correlationId}
                onRetry={() => void lots.refetch()}
                retryLabel={retryLabelFor(describeApiFailure(lots.error, "the lot list").action)}
                className="border-0 bg-transparent p-0"
              />
            ) : items.length === 0 ? (
              <p className="py-2 text-muted-foreground text-sm">
                No green lots yet. A cost is a property of a lot, so there has to be one first.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((lot) => (
                  <li key={lot.id}>
                    <button
                      type="button"
                      // The selection is announced, not just coloured: on a
                      // tablet with VoiceOver, ember and a bold weight say
                      // nothing at all.
                      aria-current={lot.id === selected ? "true" : undefined}
                      onClick={() =>
                        void navigate({ to: "/inventory/costs", search: { lotId: lot.id } })
                      }
                      className={cn(
                        "w-full py-2 text-left text-sm transition-colors hover:text-foreground",
                        lot.id === selected && "font-medium text-primary",
                      )}
                    >
                      <span className="block truncate">{lot.name}</span>
                      <span className="block truncate font-mono text-muted-foreground text-xs">
                        {lot.lotCode}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {!selected ? (
            <EmptyState
              icon={Coins}
              title="Nothing to cost yet"
              description="Receive a contract shipment or import a lot, and its landed cost appears here."
            />
          ) : cost.isLoading || !baseCurrency ? (
            // Waits for the currency rather than defaulting to one. A wrong
            // symbol on a real figure is worse than no figure, because the
            // reader has no way to tell that it is wrong.
            <Skeleton className="h-64 w-full" />
          ) : failure ? (
            <ErrorState
              title={failure.title}
              description={failure.description}
              correlationId={failure.correlationId}
              onRetry={() => void cost.refetch()}
              retryLabel={retryLabelFor(failure.action)}
            />
          ) : cost.data ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label="Total landed"
                  value={formatMoney(cost.data.totalBase, baseCurrency)}
                />
                <Metric
                  label="Per kilogram"
                  value={formatMoney(cost.data.perKgBase, baseCurrency, { digits: 4 })}
                  hint="Divided by the opening weight, not what is left"
                />
                <Metric
                  label="Opening weight"
                  value={
                    selectedLot ? formatWeight(selectedLot.initialWeightKg, { unit: "kg" }) : "—"
                  }
                />
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Where the cost came from</CardTitle>
                </CardHeader>
                <CardContent>
                  {/* No total row: it is the tile directly above, at figure
                      size. Repeating it here at body weight would make the sum
                      read as one more line item. */}
                  <dl className="divide-y divide-border">
                    {BUCKETS.map((bucket) => {
                      const amount = cost.data[bucket.key];
                      const isZero = Number.parseFloat(amount) === 0;
                      return (
                        <div
                          key={bucket.key}
                          className="flex items-center justify-between gap-3 py-2 text-sm"
                        >
                          {/* A recorded zero is an answer, so the row stays;
                              muting it keeps the eye on the figures that
                              actually make up the total. */}
                          <dt className={cn(isZero && "text-muted-foreground")}>{bucket.label}</dt>
                          <dd
                            className={cn(
                              "text-right font-mono tabular-nums",
                              isZero && "text-muted-foreground",
                            )}
                          >
                            {formatMoney(amount, baseCurrency)}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                  <p className="pt-3 text-muted-foreground text-xs">
                    {/* A zero here is a real answer, not a gap: the rollup is
                        derived from the lot's components every time it is read,
                        so an empty bucket means nothing was recorded against
                        it, never that the figure is missing. */}
                    Every figure is converted to {baseCurrency}, the currency your books are kept
                    in, at the rate recorded when each cost was entered. A zero means nothing was
                    recorded against that bucket.
                  </p>
                </CardContent>
              </Card>

              {baseCurrency ? (
                <CostComponents
                  lotId={selected}
                  baseCurrency={baseCurrency}
                  canWrite={can("inventory.green.write")}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
