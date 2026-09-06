import { StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDate, formatWeight } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/contracts/shipments")({
  validateSearch: tableSearchSchema,
  component: Shipments,
});

type Shipment = {
  id: string;
  reference: string;
  status: string;
  weightKg: string | null;
  vesselName: string | null;
  etaAt: string | null;
  receivedAt: string | null;
};

const columns: ColumnDef<Shipment>[] = [
  {
    accessorKey: "reference",
    header: "Shipment",
    meta: { label: "Shipment" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.reference}</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "weightKg",
    header: "Weight",
    meta: { label: "Weight", align: "end", unit: "kg" },
    cell: ({ row }) => formatWeight(row.original.weightKg, { unit: "kg", withUnit: false }),
  },
  {
    accessorKey: "vesselName",
    header: "Vessel",
    meta: { label: "Vessel" },
    cell: ({ row }) => row.original.vesselName ?? "—",
  },
  {
    accessorKey: "etaAt",
    header: "ETA",
    meta: { label: "ETA", align: "end" },
    cell: ({ row }) => formatDate(row.original.etaAt),
  },
  {
    accessorKey: "receivedAt",
    header: "Received",
    meta: { label: "Received", align: "end" },
    // Receiving is what turns a shipment into green lots with a landed cost —
    // until then, it is a position rather than inventory.
    cell: ({ row }) => formatDate(row.original.receivedAt),
  },
];

function Shipments() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Shipment>("sourcing.contract.listContractShipments", search);

  return (
    <ListPage
      title="Shipments"
      description="Coffee in transit, and what has landed."
      searchPlaceholder="Search shipments"
      search={search}
      query={query}
      table={{
        columns,
        rowKey: (row) => row.id,
        empty: "No shipments yet.",
      }}
    />
  );
}
