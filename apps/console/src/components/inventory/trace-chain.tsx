import { cn } from "@roastery/ui";
import { formatWeight, humanize } from "@roastery/units";
import { Link } from "@tanstack/react-router";
import { Coffee, Factory, Package, Sprout, Wheat } from "lucide-react";

export type TraceNode = {
  kind: string;
  id: string;
  label: string;
  weightKg: string | null;
};

/**
 * Where the coffee in this lot came from, walked backwards.
 *
 * Lineage is stored as edges rather than a parent pointer precisely so this can
 * be answered, and this is the screen where that decision pays for itself: a
 * recall investigation starts at a roasted lot and has to reach a producer.
 *
 * Rendered as an ordered list, not a tree diagram. The chain is a sequence, the
 * reading order is the causal order, and a boxes-and-arrows graphic would need
 * a legend to say the same thing. The weight on each step is what makes it
 * evidence rather than a breadcrumb trail: it says how much of THIS lot came
 * through that step.
 */
export function TraceChain({ chain }: { chain: TraceNode[] }) {
  if (chain.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No lineage is recorded for this lot. It was most likely brought into inventory directly
        rather than produced from a roast batch.
      </p>
    );
  }

  return (
    <ol className="relative space-y-0">
      {chain.map((node, index) => {
        const Icon = ICONS[node.kind] ?? Package;
        const last = index === chain.length - 1;
        return (
          <li key={`${node.kind}-${node.id}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-4xl ring-1",
                  // The far end of the chain is the origin, which is the answer
                  // the question was asked for.
                  last
                    ? "bg-primary/12 text-primary ring-primary/30"
                    : "bg-muted text-muted-foreground ring-border",
                )}
              >
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
              {/* The rule is decoration between steps, so it never renders
                  after the last one and leaves a line pointing at nothing. */}
              {!last ? <span className="w-px flex-1 bg-border" aria-hidden="true" /> : null}
            </div>
            <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-5")}>
              <p className="text-muted-foreground text-xs">{humanize(node.kind)}</p>
              {/* A recall investigation walks this chain and then needs to
                  open what it found. Every node carries an id; the ones with a
                  screen behind them are links, and the ones without stay text
                  rather than pretending to be clickable. */}
              {LINKABLE[node.kind] ? (
                <p className="truncate font-medium text-sm">
                  {node.kind === "green_lot" ? (
                    <Link
                      to="/inventory/$lotId"
                      params={{ lotId: node.id }}
                      className="hover:underline"
                      title={node.label}
                    >
                      {node.label}
                    </Link>
                  ) : (
                    <Link
                      to="/roasting/$batchId"
                      params={{ batchId: node.id }}
                      className="hover:underline"
                      title={node.label}
                    >
                      {node.label}
                    </Link>
                  )}
                </p>
              ) : (
                <p className="truncate font-medium text-sm" title={node.label}>
                  {node.label}
                </p>
              )}
              {node.weightKg ? (
                <p className="font-mono text-muted-foreground text-xs tabular-nums">
                  {formatWeight(node.weightKg, { unit: "kg" })}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Kinds with a screen behind them. A producer has none, so it stays text. */
const LINKABLE: Record<string, boolean> = {
  green_lot: true,
  roast_batch: true,
};

const ICONS: Record<string, typeof Package> = {
  producer: Sprout,
  green_lot: Wheat,
  roast_batch: Factory,
  roasted_lot: Coffee,
  blend_lot: Coffee,
  product_batch: Package,
};
