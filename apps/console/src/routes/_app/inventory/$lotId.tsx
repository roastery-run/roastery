import {
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
import { formatDate, formatNumber, formatWeight, humanize } from "@roastery/units";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DetailLayout } from "@/components/detail-layout";

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
    header: "#",
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
    meta: { label: "Change", align: "end" },
    cell: ({ row }) => {
      const negative = row.original.deltaKg.startsWith("-");
      return (
        <span className={negative ? "text-destructive" : "text-success"}>
          {/* The sign is explicit, not implied by colour — this table gets
              printed for stock counts. */}
          {negative ? "" : "+"}
          {formatWeight(row.original.deltaKg)}
        </span>
      );
    },
  },
  {
    accessorKey: "weightAfterKg",
    header: "Balance",
    meta: { label: "Balance", align: "end" },
    cell: ({ row }) => formatWeight(row.original.weightAfterKg),
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
    cell: ({ row }) => formatDate(row.original.occurredAt),
  },
];

function GreenLotDetail() {
  const { lotId } = Route.useParams();

  const lot = useQuery({
    queryKey: ["inventory.green.getGreenLot", lotId],
    queryFn: () => rpc<GreenLot>("inventory.green.getGreenLot", { id: lotId }),
  });

  const transactions = useQuery({
    queryKey: ["inventory.green.listGreenLotTransactions", lotId],
    queryFn: () =>
      rpc<{ items: Transaction[] }>("inventory.green.listGreenLotTransactions", {
        filter: { greenLotId: lotId },
        page: { limit: 100 },
      }),
  });

  if (lot.isError) {
    return <ErrorState title="Could not load this lot" description={lot.error.message} />;
  }

  const data = lot.data;
  const bagContext = { bagWeightKg: data?.bagWeightKg ?? null };

  return (
    <DetailLayout
      isLoading={lot.isLoading}
      title={data?.name ?? ""}
      subtitle={data ? `Registered ${formatDate(data.registeredAt)}` : undefined}
      status={data ? <StatusBadge status={data.status} /> : null}
      facts={[
        { label: "Lot code", value: data?.lotCode ?? "—" },
        { label: "Process", value: data?.processMethod ? humanize(data.processMethod) : "—" },
        { label: "Harvest", value: data?.harvestYear ?? "—" },
        { label: "Varieties", value: data?.varieties?.join(", ") || "—" },
        { label: "Opening weight", value: formatWeight(data?.initialWeightKg) },
        { label: "On hand", value: formatWeight(data?.currentWeightKg) },
        { label: "Reserved", value: formatWeight(data?.reservedWeightKg) },
        {
          // Only when the lot carries its own bag weight. A 69 kg Colombian and
          // a 60 kg Brazilian bag are both "bags"; assuming either is a 15%
          // error on somebody's stock count.
          label: "Bags",
          value: data?.bagWeightKg
            ? `${formatWeight(data.currentWeightKg, { unit: "bag", context: bagContext })} @ ${formatNumber(data.bagWeightKg, { digits: 0 })} kg`
            : "—",
        },
      ]}
    >
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Ledger</CardTitle>
        </CardHeader>
        <CardContent>
          {/* The ledger is the truth; the balance above is a cache of it. Every
              movement is here, in order, with the balance it produced — which
              is what makes a stock figure auditable rather than merely
              plausible. */}
          {transactions.data?.items.length === 0 ? (
            <EmptyState title="No movements recorded." className="border-0" />
          ) : (
            <DataTable
              data={transactions.data?.items ?? []}
              columns={txColumns}
              isLoading={transactions.isLoading}
              rowKey={(row) => row.id}
            />
          )}
        </CardContent>
      </Card>
    </DetailLayout>
  );
}
