import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  Metric,
  PageHeader,
  rpc,
} from "@roastery/ui";
import { formatDate, formatWeight } from "@roastery/units";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";

/**
 * Open positions.
 *
 * The green buyer's daily question: what is committed and not yet received.
 * Between signing a contract and the coffee arriving, that is where a
 * roastery's money sits — and in most roasteries the answer lives in
 * somebody's spreadsheet.
 */
export const Route = createFileRoute("/_app/contracts/positions")({ component: Positions });

type Position = {
  contractId: string;
  contractNumber: string;
  lineId: string;
  description: string;
  contractedKg: string;
  receivedKg: string;
  outstandingKg: string;
  deliveryFrom: string | null;
  deliveryTo: string | null;
};

const columns: ColumnDef<Position>[] = [
  {
    accessorKey: "contractNumber",
    header: "Contract",
    meta: { label: "Contract" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.contractNumber}</span>,
  },
  { accessorKey: "description", header: "Coffee", meta: { label: "Coffee" } },
  {
    accessorKey: "contractedKg",
    header: "Contracted",
    meta: { label: "Contracted", align: "end", unit: "kg" },
    cell: ({ row }) => formatWeight(row.original.contractedKg, { unit: "kg", withUnit: false }),
  },
  {
    accessorKey: "receivedKg",
    header: "Received",
    meta: { label: "Received", align: "end", unit: "kg" },
    cell: ({ row }) => formatWeight(row.original.receivedKg, { unit: "kg", withUnit: false }),
  },
  {
    accessorKey: "outstandingKg",
    header: "Outstanding",
    meta: { label: "Outstanding", align: "end", unit: "kg" },
    // The number the page exists for, so it carries the emphasis.
    cell: ({ row }) => (
      <span className="font-medium">
        {formatWeight(row.original.outstandingKg, { unit: "kg", withUnit: false })}
      </span>
    ),
  },
  {
    id: "delivery",
    header: "Delivery window",
    meta: { label: "Delivery window", align: "end" },
    cell: ({ row }) =>
      row.original.deliveryFrom || row.original.deliveryTo
        ? `${formatDate(row.original.deliveryFrom)} – ${formatDate(row.original.deliveryTo)}`
        : "—",
  },
];

function Positions() {
  const query = useQuery({
    queryKey: ["sourcing.contract.listOpenPositions"],
    queryFn: () =>
      rpc<{ items: Position[]; totalOutstandingKg: string }>(
        "sourcing.contract.listOpenPositions",
        {},
      ),
  });

  const items = query.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Open positions"
        description="What is committed and not yet received — where the money is between signing and arrival."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Outstanding"
          value={
            query.isLoading ? "—" : formatWeight(query.data?.totalOutstandingKg, { unit: "auto" })
          }
          hint="Across every open contract line"
        />
        <Metric label="Open lines" value={query.isLoading ? "—" : items.length} />
        <Metric
          label="Contracts"
          value={query.isLoading ? "—" : new Set(items.map((i) => i.contractId)).size}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">By contract line</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={items}
            columns={columns}
            isLoading={query.isLoading}
            rowKey={(row) => row.lineId}
            empty="Nothing outstanding. Every contract line has been received."
          />
        </CardContent>
      </Card>
    </div>
  );
}
