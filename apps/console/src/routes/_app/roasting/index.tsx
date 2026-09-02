import { Button, StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDateTime, formatElapsed, formatPercent, formatWeight } from "@roastery/units";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/roasting/")({
  validateSearch: tableSearchSchema,
  component: RoastBatches,
});

type RoastBatch = {
  id: string;
  batchNumber: string;
  status: string;
  machineId: string | null;
  chargeWeightKg: string | null;
  dropWeightKg: string | null;
  weightLossPct: string | null;
  dtrPct: string | null;
  totalTimeS: number | null;
  startedAt: string | null;
};

const columns: ColumnDef<RoastBatch>[] = [
  {
    accessorKey: "batchNumber",
    header: "Batch",
    meta: { label: "Batch" },
    cell: ({ row }) => (
      <Link
        to="/roasting/$batchId"
        params={{ batchId: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.original.batchNumber}
      </Link>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        <StatusBadge status={row.original.status} />
        {/* A running roast is the one thing on this screen somebody needs to
            reach immediately. */}
        {row.original.status === "in_progress" || row.original.status === "cooling" ? (
          <Link
            to="/roast/$batchId"
            params={{ batchId: row.original.id }}
            className="text-primary text-xs hover:underline"
          >
            Watch
          </Link>
        ) : null}
      </span>
    ),
  },
  {
    accessorKey: "chargeWeightKg",
    header: "Charge",
    meta: { label: "Charge", align: "end" },
    cell: ({ row }) => formatWeight(row.original.chargeWeightKg),
  },
  {
    accessorKey: "dropWeightKg",
    header: "Drop",
    meta: { label: "Drop", align: "end" },
    cell: ({ row }) => formatWeight(row.original.dropWeightKg),
  },
  {
    accessorKey: "weightLossPct",
    header: "Loss",
    meta: { label: "Loss", align: "end" },
    cell: ({ row }) => formatPercent(row.original.weightLossPct, 2),
  },
  {
    // The number a roaster judges a batch by, alongside loss. Both are stored
    // rather than derived at read time, so a report from last month still says
    // what it said last month.
    accessorKey: "dtrPct",
    header: "DTR",
    meta: { label: "Development time ratio", align: "end" },
    cell: ({ row }) => formatPercent(row.original.dtrPct, 2),
  },
  {
    accessorKey: "totalTimeS",
    header: "Time",
    meta: { label: "Total time", align: "end" },
    // mm:ss, never decimal minutes — a roaster calls first crack at 8:42.
    cell: ({ row }) => formatElapsed(row.original.totalTimeS),
  },
  {
    accessorKey: "startedAt",
    header: "Started",
    meta: { label: "Started", sortKey: "createdAt", align: "end" },
    cell: ({ row }) => formatDateTime(row.original.startedAt),
  },
];

function RoastBatches() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<RoastBatch>("production.roast.listRoastBatches", search, {
    status: search.status || undefined,
  });

  return (
    <ListPage
      title="Roast batches"
      description="Every roast, with the two numbers that judge it: weight loss and development time ratio."
      searchPlaceholder="Search batches"
      search={search}
      nextCursor={query.data?.page.nextCursor}
      actions={
        <Button size="sm">
          <Plus className="size-3.5" aria-hidden="true" />
          Start a roast
        </Button>
      }
      table={{
        data: query.data?.items ?? [],
        columns,
        isLoading: query.isLoading,
        rowKey: (row) => row.id,
        empty: "No roast batches yet.",
      }}
    />
  );
}
