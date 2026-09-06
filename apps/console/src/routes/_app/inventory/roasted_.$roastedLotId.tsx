import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  rpc,
  Skeleton,
  StatusBadge,
} from "@roastery/ui";
import {
  formatDate,
  formatDateTime,
  formatRelative,
  formatWeight,
  humanize,
} from "@roastery/units";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { DetailLayout } from "@/components/detail-layout";
import { TraceChain, type TraceNode } from "@/components/inventory/trace-chain";
import { describeApiFailure, retryLabelFor } from "@/lib/api-failure";

/**
 * One roasted lot, and where its coffee came from.
 *
 * The chain is the reason this page exists rather than a modal on the list: it
 * is what a recall investigation reads, and it is the product's argument that a
 * generic ERP cannot make.
 */
export const Route = createFileRoute("/_app/inventory/roasted_/$roastedLotId")({
  component: RoastedLotDetail,
});

type RoastedLot = {
  id: string;
  name: string;
  lotCode: string;
  lotKind: string;
  blendId: string | null;
  roastBatchId: string | null;
  roastLevel: string | null;
  initialWeightKg: string;
  currentWeightKg: string;
  reservedWeightKg: string;
  availableWeightKg: string;
  daysUntilBestBefore: number | null;
  roastedAt: string;
  bestBeforeAt: string | null;
  status: string;
};

function RoastedLotDetail() {
  const { roastedLotId } = Route.useParams();

  const lot = useQuery({
    queryKey: ["inventory.roast.getRoastedLot", roastedLotId],
    queryFn: () => rpc<RoastedLot>("inventory.roast.getRoastedLot", { id: roastedLotId }),
  });

  const trace = useQuery({
    queryKey: ["inventory.roast.getRoastedLotTraceability", roastedLotId],
    queryFn: () =>
      rpc<{ roastedLotId: string; chain: TraceNode[] }>(
        "inventory.roast.getRoastedLotTraceability",
        { id: roastedLotId },
      ),
  });

  if (lot.isError) {
    const failure = describeApiFailure(lot.error, "this roasted lot");
    return (
      <ErrorState
        title={failure.title}
        description={failure.description}
        correlationId={failure.correlationId}
        onRetry={() => void lot.refetch()}
        retryLabel={retryLabelFor(failure.action)}
      />
    );
  }

  const data = lot.data;
  const days = data?.daysUntilBestBefore ?? null;

  return (
    <DetailLayout
      isLoading={lot.isLoading}
      title={data?.name ?? ""}
      subtitle={data ? `Roasted ${formatDateTime(data.roastedAt)}` : undefined}
      status={data ? <StatusBadge status={data.status} /> : null}
      facts={[
        { label: "Lot code", mono: true, value: data?.lotCode ?? "—" },
        { label: "Kind", value: data ? humanize(data.lotKind) : "—" },
        { label: "Roast level", value: data?.roastLevel ? humanize(data.roastLevel) : "—" },
        {
          // Available is the figure somebody acts on; on-hand and reserved are
          // shown beside it rather than netted away, for the same reason they
          // are on a green lot.
          label: "Available",
          mono: true,
          primary: true,
          value: formatWeight(data?.availableWeightKg, { unit: "kg" }),
        },
        {
          label: "On hand",
          mono: true,
          primary: true,
          value: formatWeight(data?.currentWeightKg, { unit: "kg" }),
        },
        {
          label: "Reserved",
          mono: true,
          value: formatWeight(data?.reservedWeightKg, { unit: "kg" }),
        },
        {
          label: "Roasted from",
          mono: true,
          value: formatWeight(data?.initialWeightKg, { unit: "kg" }),
        },
        {
          label: "Best before",
          mono: true,
          value: data?.bestBeforeAt ? (
            <span
              className={
                days === null
                  ? undefined
                  : days < 0
                    ? "text-destructive"
                    : days <= 14
                      ? "text-warning"
                      : undefined
              }
            >
              {/* Shape as well as colour: this page gets printed with a pick
                  list, and a stale lot has to read as stale in greyscale. */}
              {days !== null && days < 0 ? "■ " : days !== null && days <= 14 ? "▲ " : ""}
              {formatDate(data.bestBeforeAt)}
              <span className="ml-1 text-muted-foreground text-xs">
                ({formatRelative(data.bestBeforeAt)})
              </span>
            </span>
          ) : (
            "—"
          ),
        },
      ]}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Where this coffee came from</CardTitle>
          </CardHeader>
          <CardContent>
            {trace.isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : trace.isError ? (
              <ErrorState
                title={describeApiFailure(trace.error, "this lot's history").title}
                description={describeApiFailure(trace.error, "this lot's history").description}
                onRetry={() => void trace.refetch()}
                retryLabel={retryLabelFor(
                  describeApiFailure(trace.error, "this lot's history").action,
                )}
                className="border-0 bg-transparent p-0"
              />
            ) : (
              <TraceChain chain={trace.data?.chain ?? []} />
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Produced by</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {data?.roastBatchId ? (
              <Link
                to="/roasting/$batchId"
                params={{ batchId: data.roastBatchId }}
                className="block text-primary hover:underline"
              >
                The roast batch that made it
              </Link>
            ) : null}
            {data?.blendId ? (
              <Link
                to="/inventory/blends/$blendId"
                params={{ blendId: data.blendId }}
                className="block text-primary hover:underline"
              >
                The blend recipe it follows
              </Link>
            ) : null}
            {!data?.roastBatchId && !data?.blendId ? (
              <p className="text-muted-foreground">
                No roast batch or blend is linked to this lot.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </DetailLayout>
  );
}
