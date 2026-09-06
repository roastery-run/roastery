import { StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatMoney, formatWeight, humanize } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/settings/products")({
  validateSearch: tableSearchSchema,
  component: Products,
});

type Product = {
  id: string;
  sku: string;
  name: string;
  format: string;
  netWeightKg: string | null;
  listPrice: string | null;
  currency: string | null;
  isActive: boolean;
};

const columns: ColumnDef<Product>[] = [
  { accessorKey: "name", header: "Product", meta: { label: "Product" } },
  {
    accessorKey: "sku",
    header: "SKU",
    meta: { label: "SKU" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku}</span>,
  },
  {
    accessorKey: "format",
    header: "Format",
    meta: { label: "Format" },
    cell: ({ row }) => humanize(row.original.format),
  },
  {
    accessorKey: "netWeightKg",
    header: "Net weight",
    meta: { label: "Net weight", align: "end" },
    // A 250 g bag formats as grams, a 5 kg sack as kilograms — the formatter
    // picks, so the column reads naturally either way. Stated rather than
    // inferred, and the unit stays in the CELL: a fixed column suffix over a
    // rescaling figure is what reports four tonnes as four kilograms.
    cell: ({ row }) => formatWeight(row.original.netWeightKg, { unit: "auto" }),
  },
  {
    accessorKey: "listPrice",
    header: "List price",
    meta: { label: "List price", align: "end" },
    cell: ({ row }) => formatMoney(row.original.listPrice, row.original.currency ?? "USD"),
  },
  {
    id: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.isActive ? "active" : "disabled"} />,
  },
];

function Products() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Product>("catalog.product.listProducts", search);

  return (
    <ListPage
      title="Products"
      description="The finished goods an order line can reference."
      searchPlaceholder="Search products"
      search={search}
      query={query}
      table={{
        columns,
        rowKey: (row) => row.id,
        empty: "No products yet.",
      }}
    />
  );
}
