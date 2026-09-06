import { StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatWeight, humanize } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/roasting/machines")({
  validateSearch: tableSearchSchema,
  component: Machines,
});

type Machine = {
  id: string;
  name: string;
  code: string;
  machineType: string;
  brand: string | null;
  capacityKg: string | null;
  minBatchKg: string | null;
  maxBatchKg: string | null;
  isActive: boolean;
};

const columns: ColumnDef<Machine>[] = [
  { accessorKey: "name", header: "Machine", meta: { label: "Machine" } },
  {
    accessorKey: "code",
    header: "Code",
    meta: { label: "Code" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "machineType",
    header: "Type",
    meta: { label: "Type" },
    cell: ({ row }) => humanize(row.original.machineType),
  },
  {
    accessorKey: "capacityKg",
    header: "Capacity",
    meta: { label: "Capacity", align: "end", unit: "kg" },
    // The scheduler sizes batches against this, so a wrong figure produces a
    // day the floor cannot run.
    cell: ({ row }) => formatWeight(row.original.capacityKg, { unit: "kg", withUnit: false }),
  },
  {
    accessorKey: "minBatchKg",
    header: "Min batch",
    meta: { label: "Minimum batch", align: "end", unit: "kg" },
    cell: ({ row }) => formatWeight(row.original.minBatchKg, { unit: "kg", withUnit: false }),
  },
  {
    id: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.isActive ? "active" : "disabled"} />,
  },
];

function Machines() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Machine>("catalog.machine.listMachines", search);

  return (
    <ListPage
      title="Machines"
      description="The drums a roast day is planned against."
      searchPlaceholder="Search machines"
      search={search}
      query={query}
      table={{
        columns,
        rowKey: (row) => row.id,
        empty: "No machines registered.",
      }}
    />
  );
}
