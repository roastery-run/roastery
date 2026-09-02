import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  EmptyState,
  Metric,
  PageHeader,
  rpc,
  Skeleton,
} from "@roastery/ui";
import { formatMoney, formatWeight, humanize } from "@roastery/units";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Coins } from "lucide-react";
import { z } from "zod";

/**
 * Landed cost, one lot at a time.
 *
 * Master and detail rather than a table of every lot, because the API exposes
 * landed cost per lot — and that is the right shape: the cost is a rollup of
 * that lot's own components, and a table of totals would hide the breakdown
 * that explains them.
 */
export const Route = createFileRoute("/_app/inventory/costs")({
  validateSearch: z.object({ lotId: z.string().optional().catch(undefined) }),
  component: LandedCosts,
});

type GreenLot = { id: string; name: string; lotCode: string; currentWeightKg: string };

type Component = { kind: string; amount: string; currency: string; amountBase: string };

type LandedCost = {
  greenLotId: string;
  currency: string;
  initialWeightKg: string;
  components: Component[];
  buckets: Record<string, string>;
  totalBase: string;
  perKgBase: string;
};

function LandedCosts() {
  const { lotId } = Route.useSearch();
  const navigate = useNavigate();

  const lots = useQuery({
    queryKey: ["inventory.green.listGreenLots", "costs"],
    queryFn: () =>
      rpc<{ items: GreenLot[] }>("inventory.green.listGreenLots", { page: { limit: 100 } }),
  });

  const selected = lotId ?? lots.data?.items[0]?.id;

  const cost = useQuery({
    queryKey: ["inventory.costing.getGreenLotLandedCost", selected],
    queryFn: () => rpc<LandedCost>("inventory.costing.getGreenLotLandedCost", { id: selected }),
    enabled: Boolean(selected),
  });

  const items = lots.data?.items ?? [];

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
            ) : (
              <ul className="divide-y divide-border">
                {items.map((lot) => (
                  <li key={lot.id}>
                    <button
                      type="button"
                      onClick={() =>
                        void navigate({ to: "/inventory/costs", search: { lotId: lot.id } })
                      }
                      className={cn(
                        "w-full py-2 text-left text-sm transition-colors hover:text-primary",
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
          {cost.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : cost.isError || !cost.data ? (
            <EmptyState
              icon={Coins}
              title="No cost recorded for this lot"
              description="Cost components arrive with a contract receipt, or can be set directly."
            />
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  label="Total landed"
                  value={formatMoney(cost.data.totalBase, cost.data.currency)}
                />
                <Metric
                  label="Per kilogram"
                  value={formatMoney(cost.data.perKgBase, cost.data.currency, { digits: 4 })}
                  hint="Divided by the opening weight, not what is left"
                />
                <Metric label="Opening weight" value={formatWeight(cost.data.initialWeightKg)} />
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Components</CardTitle>
                </CardHeader>
                <CardContent>
                  {cost.data.components.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No components recorded for this lot.
                    </p>
                  ) : (
                    <dl className="divide-y divide-border">
                      {cost.data.components.map((component, index) => (
                        <div
                          // biome-ignore lint/suspicious/noArrayIndexKey: components have no id.
                          key={`${component.kind}-${index}`}
                          className="flex items-center justify-between gap-3 py-2 text-sm"
                        >
                          <dt>{humanize(component.kind)}</dt>
                          <dd className="text-right font-mono tabular-nums">
                            {formatMoney(component.amount, component.currency)}
                            {/* Both figures where they differ: the original
                                currency is what the invoice says, the base is
                                what the books are kept in, and the rate used
                                was the one on the day. */}
                            {component.currency !== cost.data?.currency ? (
                              <span className="ml-2 text-muted-foreground text-xs">
                                = {formatMoney(component.amountBase, cost.data?.currency ?? "USD")}
                              </span>
                            ) : null}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
