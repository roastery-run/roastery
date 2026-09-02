import { StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDate, formatNumber, humanize } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/quality/gradings")({
  validateSearch: tableSearchSchema,
  component: Gradings,
});

type Grading = {
  id: string;
  standard: string;
  grade: string | null;
  passed: boolean;
  moisturePct: string | null;
  waterActivity: string | null;
  defectsPrimary: number;
  defectsSecondary: number;
  fullDefectEquivalents: string | null;
  createdAt: string;
};

const columns: ColumnDef<Grading>[] = [
  {
    accessorKey: "standard",
    header: "Standard",
    meta: { label: "Standard" },
    cell: ({ row }) => humanize(row.original.standard),
  },
  {
    id: "result",
    header: "Result",
    meta: { label: "Result" },
    // The one column that matters: a failing grading quarantines the lot.
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.passed ? "passed" : "failed"}
        label={row.original.grade ? humanize(row.original.grade) : undefined}
      />
    ),
  },
  {
    accessorKey: "defectsPrimary",
    header: "Primary",
    meta: { label: "Primary defects", align: "end" },
  },
  {
    accessorKey: "defectsSecondary",
    header: "Secondary",
    meta: { label: "Secondary defects", align: "end" },
  },
  {
    accessorKey: "fullDefectEquivalents",
    header: "Full defects",
    meta: { label: "Full defect equivalents", align: "end" },
    // The figure the standard actually judges: primaries count fully,
    // secondaries at a fraction.
    cell: ({ row }) => formatNumber(row.original.fullDefectEquivalents, { digits: 2 }),
  },
  {
    accessorKey: "moisturePct",
    header: "Moisture",
    meta: { label: "Moisture", align: "end", unit: "%" },
    cell: ({ row }) => formatNumber(row.original.moisturePct, { digits: 2 }),
  },
  {
    accessorKey: "waterActivity",
    header: "aW",
    meta: { label: "Water activity", align: "end" },
    cell: ({ row }) => formatNumber(row.original.waterActivity, { digits: 3 }),
  },
  {
    accessorKey: "createdAt",
    header: "Graded",
    meta: { label: "Graded", sortKey: "createdAt", align: "end" },
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

function Gradings() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Grading>("quality.grading.listGradings", search);

  return (
    <ListPage
      title="Gradings"
      description="Physical assessments, and which lots they stopped."
      searchPlaceholder="Search gradings"
      search={search}
      nextCursor={query.data?.page.nextCursor}
      table={{
        data: query.data?.items ?? [],
        columns,
        isLoading: query.isLoading,
        rowKey: (row) => row.id,
        empty: "No gradings recorded.",
      }}
    />
  );
}
