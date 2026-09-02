import { StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDate, formatWeight, humanize } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/inventory/roasted")({
  validateSearch: tableSearchSchema,
  component: RoastedLots,
});

type RoastedLot = {
  id: string;
  name: string;
  lotCode: string;
  lotKind: string;
  roastLevel: string | null;
  currentWeightKg: string;
  reservedWeightKg: string;
  bestBeforeAt: string | null;
  status: string;
};

const columns: ColumnDef<RoastedLot>[] = [
  { accessorKey: "name", header: "Lot", meta: { label: "Lot" } },
  {
    accessorKey: "lotCode",
    header: "Code",
    meta: { label: "Code" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.lotCode}</span>,
  },
  {
    accessorKey: "roastLevel",
    header: "Roast",
    meta: { label: "Roast" },
    cell: ({ row }) => humanize(row.original.roastLevel),
  },
  {
    accessorKey: "currentWeightKg",
    header: "On hand",
    meta: { label: "On hand", align: "end" },
    cell: ({ row }) => formatWeight(row.original.currentWeightKg),
  },
  {
    accessorKey: "reservedWeightKg",
    header: "Reserved",
    meta: { label: "Reserved", align: "end" },
    cell: ({ row }) => formatWeight(row.original.reservedWeightKg),
  },
  {
    accessorKey: "bestBeforeAt",
    header: "Best before",
    meta: { label: "Best before", align: "end" },
    // The column allocation sorts on: roasted coffee ships first-expiry-first-out.
    cell: ({ row }) => formatDate(row.original.bestBeforeAt),
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
];

function RoastedLots() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<RoastedLot>("inventory.roast.listRoastedLots", search, {
    status: search.status || undefined,
  });

  return (
    <ListPage
      title="Roasted coffee"
      description="Finished stock, and how soon each lot goes stale."
      searchPlaceholder="Search roasted lots"
      search={search}
      nextCursor={query.data?.page.nextCursor}
      table={{
        data: query.data?.items ?? [],
        columns,
        isLoading: query.isLoading,
        rowKey: (row) => row.id,
        empty: "No roasted coffee yet. Complete a roast to create some.",
      }}
    />
  );
}
