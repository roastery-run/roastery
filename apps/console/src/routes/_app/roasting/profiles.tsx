import { StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatElapsed, formatPercent, formatWeight } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/roasting/profiles")({
  validateSearch: tableSearchSchema,
  component: Profiles,
});

type Profile = {
  id: string;
  name: string;
  code: string;
  version: number;
  targetChargeKg: string | null;
  targetDropTempC: string | null;
  targetTotalTimeS: number | null;
  targetDtrPct: string | null;
  isActive: boolean;
};

const columns: ColumnDef<Profile>[] = [
  { accessorKey: "name", header: "Profile", meta: { label: "Profile" } },
  {
    accessorKey: "code",
    header: "Code",
    meta: { label: "Code" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "version",
    header: "Version",
    meta: { label: "Version", align: "end" },
    // Profiles are versioned so a batch roasted last year can still be read
    // against the profile that was in force then.
    cell: ({ row }) => `v${row.original.version}`,
  },
  {
    accessorKey: "targetChargeKg",
    header: "Charge",
    meta: { label: "Target charge", align: "end", unit: "kg" },
    cell: ({ row }) => formatWeight(row.original.targetChargeKg, { unit: "kg", withUnit: false }),
  },
  {
    accessorKey: "targetDropTempC",
    header: "Drop temp",
    meta: { label: "Target drop temperature", align: "end" },
    cell: ({ row }) => (row.original.targetDropTempC ? `${row.original.targetDropTempC} °C` : "—"),
  },
  {
    accessorKey: "targetTotalTimeS",
    header: "Time",
    meta: { label: "Target total time", align: "end" },
    cell: ({ row }) => formatElapsed(row.original.targetTotalTimeS),
  },
  {
    accessorKey: "targetDtrPct",
    header: "Target DTR",
    meta: { label: "Target development time ratio", align: "end" },
    cell: ({ row }) => formatPercent(row.original.targetDtrPct, 2),
  },
  {
    id: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.isActive ? "active" : "disabled"} />,
  },
];

function Profiles() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Profile>("production.profile.listProfiles", search);

  return (
    <ListPage
      title="Roast profiles"
      description="The targets a batch is judged against."
      searchPlaceholder="Search profiles"
      search={search}
      query={query}
      table={{
        columns,
        rowKey: (row) => row.id,
        empty: "No profiles yet.",
      }}
    />
  );
}
