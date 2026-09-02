import { StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDate } from "@roastery/units";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/cafe/")({
  validateSearch: tableSearchSchema,
  component: Sites,
});

type Site = {
  id: string;
  name: string;
  code: string;
  timezone: string | null;
  isActive: boolean;
  createdAt: string;
};

const columns: ColumnDef<Site>[] = [
  {
    accessorKey: "name",
    header: "Site",
    meta: { label: "Site" },
    cell: ({ row }) => (
      <Link
        to="/cafe/live"
        search={{ siteId: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "code",
    header: "Code",
    meta: { label: "Code" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "timezone",
    header: "Timezone",
    meta: { label: "Timezone" },
    // A café's business day is local, never UTC — reconciliation depends on it.
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

function Sites() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Site>("cafe.listSites", search);

  return (
    <ListPage
      title="Café sites"
      description="Every bar, and the equipment reporting from it."
      searchPlaceholder="Search sites"
      search={search}
      nextCursor={query.data?.page.nextCursor}
      table={{
        data: query.data?.items ?? [],
        columns,
        isLoading: query.isLoading,
        rowKey: (row) => row.id,
        empty: "No café sites yet.",
      }}
    />
  );
}
