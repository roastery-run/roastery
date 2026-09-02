import { Button, StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDate, formatMoney } from "@roastery/units";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/orders/")({
  validateSearch: tableSearchSchema,
  component: Orders,
});

type Order = {
  id: string;
  orderNumber: string;
  customerId: string;
  channel: string;
  status: string;
  currency: string;
  total: string;
  orderedAt: string;
  requestedShipAt: string | null;
};

const columns: ColumnDef<Order>[] = [
  {
    accessorKey: "orderNumber",
    header: "Order",
    meta: { label: "Order" },
    cell: ({ row }) => (
      <Link
        to="/orders/$orderId"
        params={{ orderId: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.original.orderNumber}
      </Link>
    ),
  },
  {
    accessorKey: "channel",
    header: "Channel",
    meta: { label: "Channel" },
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.channel}</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "requestedShipAt",
    header: "Ships",
    meta: { label: "Ships", align: "end" },
    cell: ({ row }) => formatDate(row.original.requestedShipAt),
  },
  {
    accessorKey: "total",
    header: "Total",
    meta: { label: "Total", align: "end" },
    cell: ({ row }) => formatMoney(row.original.total, row.original.currency),
  },
  {
    accessorKey: "orderedAt",
    header: "Ordered",
    meta: { label: "Ordered", sortKey: "createdAt", align: "end" },
    cell: ({ row }) => formatDate(row.original.orderedAt),
  },
];

function Orders() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Order>("orders.listOrders", search, {
    status: search.status || undefined,
  });

  return (
    <ListPage
      title="Orders"
      description="What has been sold, and what production still has to cover."
      searchPlaceholder="Search orders"
      search={search}
      nextCursor={query.data?.page.nextCursor}
      actions={
        <Button size="sm">
          <Plus className="size-3.5" aria-hidden="true" />
          New order
        </Button>
      }
      table={{
        data: query.data?.items ?? [],
        columns,
        isLoading: query.isLoading,
        rowKey: (row) => row.id,
        empty: "No orders yet.",
      }}
    />
  );
}
