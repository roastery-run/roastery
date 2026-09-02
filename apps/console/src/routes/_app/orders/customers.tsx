import { StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDate, humanize } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/orders/customers")({
  validateSearch: tableSearchSchema,
  component: Customers,
});

type Customer = {
  id: string;
  name: string;
  code: string;
  customerType: string;
  currency: string;
  paymentTermsDays: number | null;
  contactEmail: string | null;
  isActive: boolean;
  createdAt: string;
};

const columns: ColumnDef<Customer>[] = [
  { accessorKey: "name", header: "Customer", meta: { label: "Customer" } },
  {
    accessorKey: "code",
    header: "Code",
    meta: { label: "Code" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "customerType",
    header: "Type",
    meta: { label: "Type" },
    cell: ({ row }) => humanize(row.original.customerType),
  },
  {
    accessorKey: "paymentTermsDays",
    header: "Terms",
    meta: { label: "Payment terms", align: "end" },
    cell: ({ row }) =>
      row.original.paymentTermsDays === null ? "—" : `${row.original.paymentTermsDays} days`,
  },
  {
    accessorKey: "contactEmail",
    header: "Contact",
    meta: { label: "Contact" },
    cell: ({ row }) => row.original.contactEmail ?? "—",
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

function Customers() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Customer>("orders.listCustomers", search);

  return (
    <ListPage
      title="Customers"
      description="Who buys the coffee, and on what terms."
      searchPlaceholder="Search customers"
      search={search}
      nextCursor={query.data?.page.nextCursor}
      table={{
        data: query.data?.items ?? [],
        columns,
        isLoading: query.isLoading,
        rowKey: (row) => row.id,
        empty: "No customers yet.",
      }}
    />
  );
}
