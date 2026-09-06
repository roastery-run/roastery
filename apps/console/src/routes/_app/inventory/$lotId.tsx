import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  ErrorState,
  rpc,
  StatusBadge,
} from "@roastery/ui";
import { formatDate, formatDateTime, formatNumber, formatWeight, humanize } from "@roastery/units";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle } from "lucide-react";
import { DetailLayout } from "@/components/detail-layout";
import { LotActions } from "@/components/inventory/lot-actions";
import { QuarantinePanel } from "@/components/inventory/quarantine-panel";
import { describeApiFailure, retryLabelFor } from "@/lib/api-failure";
import { detectLedgerDrift } from "@/lib/ledger-drift";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_app/inventory/$lotId")({ component: GreenLotDetail });

type GreenLot = {
  id: string;
  name: string;
  lotCode: string;
  status: string;
  processMethod: string | null;
  harvestYear: number | null;
  varieties: string[];
  initialWeightKg: string;
  currentWeightKg: string;
  reservedWeightKg: string;
  bagCount: number | null;
  bagWeightKg: string | null;
  unitCost: string | null;
  currency: string | null;
  registeredAt: string;
};

type Transaction = {
  id: string;
  seq: number;
  eventType: string;
  deltaKg: string;
  weightAfterKg: string;
  comment: string | null;
  occurredAt: string;
};

const txColumns: ColumnDef<Transaction>[] = [
  {
    accessorKey: "seq",
    // The wire field is `seq`, and so is the word support uses on the phone.
    // A bare "#" made the one column that orders the ledger unnameable.
    header: "Seq",
    meta: { label: "Sequence", align: "end", width: "4rem" },
  },
  {
    accessorKey: "eventType",
    header: "Movement",
    meta: { label: "Movement" },
    cell: ({ row }) => humanize(row.original.eventType),
  },
  {
    accessorKey: "deltaKg",
    header: "Change",
    meta: { label: "Change", align: "end", unit: "kg" },
    cell: ({ row }) => {
      const negative = row.original.deltaKg.startsWith("-");
      return (
        <span className={negative ? "text-destructive" : "text-success"}>
          {/* The sign is explicit, not implied by colour — this table gets
              printed for stock counts. */}
          {negative ? "" : "+"}
          {formatWeight(row.original.deltaKg, { unit: "kg", withUnit: false })}
        </span>
      );
    },
  },
  {
    accessorKey: "weightAfterKg",
    header: "Balance",
    meta: { label: "Balance", align: "end", unit: "kg" },
    cell: ({ row }) => formatWeight(row.original.weightAfterKg, { unit: "kg", withUnit: false }),
  },
  {
    accessorKey: "comment",
    header: "Note",
    meta: { label: "Note" },
    cell: ({ row }) => row.original.comment ?? "—",
  },
  {
    accessorKey: "occurredAt",
    header: "When",
    meta: { label: "When", align: "end" },
    // With the date alone, two movements on one afternoon are distinguishable
    // only by their sequence number — on the table whose whole job is saying
    // what happened in what order.
    cell: ({ row }) => formatDateTime(row.original.occurredAt),
  },
];

function GreenLotDetail() {
  const { lotId } = Route.useParams();
  const { can } = useWorkspace();

  const lot = useQuery({
    queryKey: ["inventory.green.getGreenLot", lotId],
    queryFn: () => rpc<GreenLot>("inventory.green.getGreenLot", { id: lotId }),
  });

  // Paged, not capped. The ledger is what makes a balance auditable, so a
  // ledger the screen cannot finish showing is an argument it cannot finish
  // making. Walked backwards a page at a time rather than with Previous/Next:
  // this is a history, and the reader is going further back, not to "page 4".
  const transactions = useInfiniteQuery({
    queryKey: ["inventory.green.listGreenLotTransactions", lotId],
    queryFn: ({ pageParam }) =>
      rpc<{ items: Transaction[]; page: { nextCursor: string | null; hasMore: boolean } }>(
        "inventory.green.listGreenLotTransactions",
        {
          filter: { greenLotId: lotId },
          page: { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) },
        },
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.page.nextCursor ?? undefined,
  });

  if (lot.isError) {
    // Everything else routes through the shared mapping; a raw API message
    // here means one screen speaks a different language on the one page where
    // somebody is checking whether a number can be trusted.
    const failure = describeApiFailure(lot.error, "this lot");
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
  const bagContext = { bagWeightKg: data?.bagWeightKg ?? null };
  const entries = transactions.data?.pages.flatMap((page) => page.items) ?? [];
  // Only once both have actually arrived: comparing a loaded cache against an
  // unloaded ledger would report drift on every first paint.
  const drift =
    lot.isSuccess && transactions.isSuccess
      ? detectLedgerDrift({
          cachedKg: data?.currentWeightKg,
          newestBalanceKg: entries[0]?.weightAfterKg,
          hasEntries: entries.length > 0,
        })
      : null;

  return (
    <DetailLayout
      isLoading={lot.isLoading}
      title={data?.name ?? ""}
      subtitle={data ? `Registered ${formatDate(data.registeredAt)}` : undefined}
      status={data ? <StatusBadge status={data.status} /> : null}
      actions={data ? <LotActions lot={data} canWrite={can("inventory.green.write")} /> : null}
      facts={[
        { label: "Lot code", mono: true, value: data?.lotCode ?? "—" },
        { label: "Process", value: data?.processMethod ? humanize(data.processMethod) : "—" },
        { label: "Harvest", mono: true, value: data?.harvestYear ?? "—" },
        { label: "Varieties", value: data?.varieties?.join(", ") || "—" },
        {
          label: "Opening weight",
          mono: true,
          value: formatWeight(data?.initialWeightKg, { unit: "kg" }),
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
          primary: true,
          value: formatWeight(data?.reservedWeightKg, { unit: "kg" }),
        },
        {
          // Only when the lot carries its own bag weight. A 69 kg Colombian and
          // a 60 kg Brazilian bag are both "bags"; assuming either is a 15%
          // error on somebody's stock count.
          label: "Bags",
          mono: true,
          value: data?.bagWeightKg
            ? `${formatWeight(data.currentWeightKg, { unit: "bag", context: bagContext })} @ ${formatNumber(data.bagWeightKg, { digits: 0 })} kg`
            : "—",
        },
      ]}
    >
      {data?.status === "quarantined" ? (
        <QuarantinePanel lotId={lotId} canRelease={can("quality.grading.write")} />
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Ledger</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* The ledger is the truth; the balance above is a cache of it. Every
              movement is here, in order, with the balance it produced — which
              is what makes a stock figure auditable rather than merely
              plausible. */}
          {drift ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertTitle>The balance above does not match this ledger</AlertTitle>
              <AlertDescription>
                {/* Named, not corrected: writing the ledger's figure over the
                    cache would hide whatever caused them to diverge, and every
                    other screen in the product reads the cache. */}
                {/* Mono on the three figures and nowhere else in the sentence:
                    these are the numbers somebody reads back to support, and
                    the prose around them is prose. */}
                The lot record says{" "}
                <span className="font-mono">{formatWeight(drift.cachedKg, { unit: "kg" })}</span>
                {"; "}the newest entry here ends at{" "}
                <span className="font-mono">{formatWeight(drift.ledgerKg, { unit: "kg" })}</span>, a
                difference of{" "}
                <span className="font-mono">
                  {formatWeight(drift.differenceKg, { unit: "kg" })}
                </span>
                . Nothing has been changed. Send this lot code to support rather than adjusting the
                difference away, because an adjustment would bury the cause.
              </AlertDescription>
            </Alert>
          ) : null}

          {transactions.isSuccess && entries.length === 0 ? (
            <EmptyState title="No movements recorded." className="border-0" />
          ) : (
            <>
              <DataTable
                data={entries}
                columns={txColumns}
                isLoading={transactions.isLoading}
                rowKey={(row) => row.id}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-muted-foreground text-xs">
                  <span className="font-mono">{entries.length}</span>{" "}
                  {entries.length === 1 ? "movement" : "movements"}
                  {transactions.hasNextPage ? ", and older ones below" : " — the whole history"}
                </p>
                {transactions.hasNextPage ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={transactions.isFetchingNextPage}
                    onClick={() => void transactions.fetchNextPage()}
                  >
                    {transactions.isFetchingNextPage ? "Loading" : "Load older movements"}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </DetailLayout>
  );
}
