import { StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDate, formatWeight, humanize } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/samples/")({
  validateSearch: tableSearchSchema,
  component: Samples,
});

type Sample = {
  id: string;
  sampleNumber: string;
  name: string;
  sampleType: string;
  status: string;
  weightKg: string | null;
  receivedAt: string | null;
  createdAt: string;
};

const columns: ColumnDef<Sample>[] = [
  { accessorKey: "name", header: "Sample", meta: { label: "Sample" } },
  {
    accessorKey: "sampleNumber",
    header: "Number",
    meta: { label: "Number" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.sampleNumber}</span>,
  },
  {
    accessorKey: "sampleType",
    header: "Type",
    meta: { label: "Type" },
    cell: ({ row }) => humanize(row.original.sampleType),
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "weightKg",
    header: "Weight",
    meta: { label: "Weight", align: "end" },
    // Samples are hundreds of grams, so the formatter picks grams here.
    cell: ({ row }) => formatWeight(row.original.weightKg),
  },
  {
    accessorKey: "createdAt",
    header: "Logged",
    meta: { label: "Logged", sortKey: "createdAt", align: "end" },
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

function Samples() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Sample>("sourcing.sample.listSamples", search, {
    status: search.status || undefined,
  });

  return (
    <ListPage
      title="Samples"
      description="Offers, pre-shipments and arrivals, and how long each has been waiting on a decision."
      searchPlaceholder="Search samples"
      search={search}
      nextCursor={query.data?.page.nextCursor}
      table={{
        data: query.data?.items ?? [],
        columns,
        isLoading: query.isLoading,
        rowKey: (row) => row.id,
        empty: "No samples logged.",
      }}
    />
  );
}
