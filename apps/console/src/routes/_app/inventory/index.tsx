import { Button, StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDate, formatWeight, humanize } from "@roastery/units";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/inventory/")({
  validateSearch: tableSearchSchema,
  component: GreenLots,
});

type GreenLot = {
  id: string;
  name: string;
  lotCode: string;
  status: string;
  processMethod: string | null;
  harvestYear: number | null;
  currentWeightKg: string;
  reservedWeightKg: string;
  bagWeightKg: string | null;
  registeredAt: string;
};

const columns: ColumnDef<GreenLot>[] = [
  {
    accessorKey: "name",
    header: "Lot",
    meta: { label: "Lot", sortKey: "name" },
    cell: ({ row }) => (
      <Link
        to="/inventory/$lotId"
        params={{ lotId: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "lotCode",
    header: "Code",
    meta: { label: "Code" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.lotCode}</span>,
  },
  {
    accessorKey: "processMethod",
    header: "Process",
    meta: { label: "Process" },
    cell: ({ row }) => humanize(row.original.processMethod),
  },
  {
    accessorKey: "harvestYear",
    header: "Harvest",
    meta: { label: "Harvest", align: "end" },
    cell: ({ row }) => row.original.harvestYear ?? "—",
  },
  {
    accessorKey: "currentWeightKg",
    header: "On hand",
    meta: { label: "On hand", align: "end" },
    cell: ({ row }) => formatWeight(row.original.currentWeightKg),
  },
  {
    // Shown next to the total rather than netted off it: an operator needs to
    // know both what is physically there and what is already promised, and a
    // single "available" figure hides the difference.
    accessorKey: "reservedWeightKg",
    header: "Reserved",
    meta: { label: "Reserved", align: "end" },
    cell: ({ row }) => formatWeight(row.original.reservedWeightKg),
  },
  {
    id: "bags",
    header: "Bags",
    meta: { label: "Bags", align: "end" },
    // Bags only where the lot records its own bag weight. A default would
    // misreport a Colombian lot by 17% against a Brazilian one.
    cell: ({ row }) =>
      row.original.bagWeightKg
        ? formatWeight(row.original.currentWeightKg, {
            unit: "bag",
            context: { bagWeightKg: row.original.bagWeightKg },
          })
        : "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "registeredAt",
    header: "Registered",
    meta: { label: "Registered", sortKey: "createdAt", align: "end" },
    cell: ({ row }) => formatDate(row.original.registeredAt),
  },
];

function GreenLots() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<GreenLot>("inventory.green.listGreenLots", search, {
    status: search.status || undefined,
  });

  return (
    <ListPage
      title="Green coffee"
      description="Every lot, what is on hand, and what is already promised."
      searchPlaceholder="Search lots"
      search={search}
      nextCursor={query.data?.page.nextCursor}
      actions={
        <Button size="sm">
          <Plus className="size-3.5" aria-hidden="true" />
          Import lot
        </Button>
      }
      table={{
        data: query.data?.items ?? [],
        columns,
        isLoading: query.isLoading,
        rowKey: (row) => row.id,
        empty: "No green coffee yet. Import a lot or receive a contract shipment.",
      }}
    />
  );
}
