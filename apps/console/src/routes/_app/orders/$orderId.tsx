import {
  ApiError,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  ErrorState,
  rpc,
  rpcMutate,
  StatusBadge,
} from "@roastery/ui";
import { formatDate, formatMoney, formatWeight, humanize } from "@roastery/units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { DetailLayout } from "@/components/detail-layout";

export const Route = createFileRoute("/_app/orders/$orderId")({ component: OrderDetail });

type Line = {
  id: string;
  position: number;
  description: string;
  quantity: string;
  weightKg: string;
  allocatedWeightKg: string;
  outstandingWeightKg: string;
  unitPrice: string | null;
};

type Order = {
  id: string;
  orderNumber: string;
  channel: string;
  status: string;
  currency: string;
  total: string;
  orderedAt: string;
  requestedShipAt: string | null;
  lines: Line[];
};

function OrderDetail() {
  const { orderId } = Route.useParams();
  const queryClient = useQueryClient();

  const order = useQuery({
    queryKey: ["orders.getOrder", orderId],
    queryFn: () => rpc<Order>("orders.getOrder", { id: orderId }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["orders.getOrder", orderId] });
    void queryClient.invalidateQueries({ queryKey: ["orders.listOrders"] });
  };

  const confirm = useMutation({
    mutationFn: () => rpcMutate<Order>("orders.confirmOrder", { id: orderId }),
    onSuccess: () => {
      toast.success("Order confirmed", {
        description: "It is now demand that production will plan against.",
      });
      invalidate();
    },
    onError: (error) => toast.error(describe(error)),
  });

  const allocate = useMutation({
    mutationFn: () =>
      rpcMutate<{ lines: { shortfallKg: string; allocatedKg: string }[] }>("orders.allocateOrder", {
        id: orderId,
        strategy: "fefo",
      }),
    onSuccess: (result) => {
      const short = result.lines.reduce((sum, l) => sum + Number.parseFloat(l.shortfallKg), 0);
      // A partial allocation is reported as a shortfall, never as success —
      // an order that looks allocated and is not is how a warehouse ships short.
      if (short > 0) {
        toast.warning("Allocated what was available", {
          description: `${short.toFixed(2)} kg could not be covered from stock.`,
        });
      } else {
        toast.success("Fully allocated from stock");
      }
      invalidate();
    },
    onError: (error) => toast.error(describe(error)),
  });

  const columns: ColumnDef<Line>[] = [
    {
      accessorKey: "position",
      header: "#",
      meta: { label: "Line", align: "end", width: "3rem" },
      cell: ({ row }) => row.original.position + 1,
    },
    { accessorKey: "description", header: "Item", meta: { label: "Item" } },
    {
      accessorKey: "weightKg",
      header: "Ordered",
      meta: { label: "Ordered", align: "end", unit: "kg" },
      cell: ({ row }) => formatWeight(row.original.weightKg, { unit: "kg", withUnit: false }),
    },
    {
      accessorKey: "allocatedWeightKg",
      header: "Allocated",
      meta: { label: "Allocated", align: "end", unit: "kg" },
      cell: ({ row }) =>
        formatWeight(row.original.allocatedWeightKg, { unit: "kg", withUnit: false }),
    },
    {
      accessorKey: "outstandingWeightKg",
      header: "Outstanding",
      meta: { label: "Outstanding", align: "end", unit: "kg" },
      cell: ({ row }) => {
        const outstanding = Number.parseFloat(row.original.outstandingWeightKg);
        return (
          <span className={outstanding > 0 ? "text-warning" : "text-muted-foreground"}>
            {formatWeight(row.original.outstandingWeightKg, { unit: "kg", withUnit: false })}
          </span>
        );
      },
    },
    {
      accessorKey: "unitPrice",
      header: "Unit price",
      meta: { label: "Unit price", align: "end" },
      cell: ({ row }) =>
        row.original.unitPrice
          ? formatMoney(row.original.unitPrice, order.data?.currency ?? "USD", { digits: 2 })
          : "—",
    },
  ];

  if (order.isError) {
    return <ErrorState title="Could not load this order" description={order.error.message} />;
  }

  const data = order.data;

  return (
    <DetailLayout
      isLoading={order.isLoading}
      title={data?.orderNumber ?? ""}
      subtitle={data ? `Ordered ${formatDate(data.orderedAt)}` : undefined}
      status={data ? <StatusBadge status={data.status} /> : null}
      actions={
        <>
          {data?.status === "draft" ? (
            <Button size="sm" onClick={() => confirm.mutate()} disabled={confirm.isPending}>
              Confirm order
            </Button>
          ) : null}
          {data && data.status !== "draft" ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => allocate.mutate()}
              disabled={allocate.isPending}
            >
              Allocate stock
            </Button>
          ) : null}
        </>
      }
      facts={[
        { label: "Channel", value: data ? humanize(data.channel) : "—" },
        { label: "Requested ship", mono: true, value: formatDate(data?.requestedShipAt) },
        { label: "Lines", mono: true, value: data?.lines.length ?? "—" },
        {
          label: "Total",
          mono: true,
          value: data ? formatMoney(data.total, data.currency) : "—",
        },
      ]}
    >
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Lines</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={data?.lines ?? []}
            columns={columns}
            rowKey={(row) => row.id}
            empty="This order has no lines."
          />
        </CardContent>
      </Card>
    </DetailLayout>
  );
}

/** Turns an API failure into something a person can act on. */
function describe(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.isEntitlement) return "Your plan does not include this.";
    return error.message;
  }
  return "Something went wrong.";
}
