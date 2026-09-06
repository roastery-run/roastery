import { StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDate, humanize } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/settings/locations")({
  validateSearch: tableSearchSchema,
  component: Locations,
});

type Location = {
  id: string;
  name: string;
  code: string;
  kind: string;
  timezone: string | null;
  isActive: boolean;
  createdAt: string;
};

const columns: ColumnDef<Location>[] = [
  { accessorKey: "name", header: "Location", meta: { label: "Location" } },
  {
    accessorKey: "code",
    header: "Code",
    meta: { label: "Code" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "kind",
    header: "Kind",
    meta: { label: "Kind" },
    cell: ({ row }) => humanize(row.original.kind),
  },
  {
    accessorKey: "timezone",
    header: "Timezone",
    meta: { label: "Timezone" },
    cell: ({ row }) => row.original.timezone ?? "—",
  },
  {
    id: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.isActive ? "active" : "disabled"} />,
  },
  {
    accessorKey: "createdAt",
    header: "Added",
    meta: { label: "Added", sortKey: "createdAt", align: "end" },
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

function Locations() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Location>("catalog.location.listLocations", search);

  return (
    <ListPage
      title="Locations"
      description="Warehouses, roasteries and cafés. Inventory balances are tracked per location."
      searchPlaceholder="Search locations"
      search={search}
      query={query}
      table={{
        columns,
        rowKey: (row) => row.id,
        empty: "No locations yet.",
      }}
    />
  );
}
