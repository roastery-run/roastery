import { StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatNumber, humanize } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/inventory/materials")({
  validateSearch: tableSearchSchema,
  component: Materials,
});

type Material = {
  id: string;
  name: string;
  sku: string;
  kind: string;
  currentQuantity: string;
  minQuantity: string | null;
  unitCost: string | null;
  isActive: boolean;
};

const columns: ColumnDef<Material>[] = [
  { accessorKey: "name", header: "Material", meta: { label: "Material" } },
  {
    accessorKey: "sku",
    header: "SKU",
    meta: { label: "SKU" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku}</span>,
  },
  {
    accessorKey: "kind",
    header: "Kind",
    meta: { label: "Kind" },
    cell: ({ row }) => humanize(row.original.kind),
  },
  {
    accessorKey: "currentQuantity",
    header: "On hand",
    meta: { label: "On hand", align: "end" },
    cell: ({ row }) => {
      const current = Number.parseFloat(row.original.currentQuantity);
      const minimum = row.original.minQuantity ? Number.parseFloat(row.original.minQuantity) : null;
      const low = minimum !== null && current <= minimum;
      return (
        // Below the minimum is called out here rather than only in the daily
        // digest: somebody looking at this list is deciding what to order.
        <span className={low ? "font-medium text-warning" : undefined}>
          {formatNumber(current, { digits: 2 })}
        </span>
      );
    },
  },
  {
    accessorKey: "minQuantity",
    header: "Minimum",
    meta: { label: "Minimum", align: "end" },
    cell: ({ row }) => formatNumber(row.original.minQuantity, { digits: 2 }),
  },
  {
    id: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.isActive ? "active" : "disabled"} />,
  },
];

function Materials() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Material>("inventory.material.listMaterials", search);

  return (
    <ListPage
      title="Materials"
      description="Packaging, labels and everything else a finished bag needs."
      searchPlaceholder="Search materials"
      search={search}
      nextCursor={query.data?.page.nextCursor}
      table={{
        data: query.data?.items ?? [],
        columns,
        isLoading: query.isLoading,
        rowKey: (row) => row.id,
        empty: "No materials yet.",
      }}
    />
  );
}
