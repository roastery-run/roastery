import { Badge, Button, StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatPercent, humanize } from "@roastery/units";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { ListFilter } from "@/components/list-filter";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/inventory/blends")({
  validateSearch: tableSearchSchema,
  component: Blends,
});

type Blend = {
  id: string;
  name: string;
  code: string;
  blendType: string;
  targetWeightLossPct: string | null;
  roastLevel: string | null;
  isDecaf: boolean;
  isActive: boolean;
};

const columns: ColumnDef<Blend>[] = [
  {
    accessorKey: "name",
    header: "Blend",
    meta: { label: "Blend" },
    cell: ({ row }) => (
      <Link
        to="/inventory/blends/$blendId"
        params={{ blendId: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "code",
    header: "Code",
    meta: { label: "Code" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "blendType",
    header: "Type",
    meta: { label: "Type" },
    // Pre- and post-roast blends have identical shape but very different
    // meaning: one is blended green and roasted together, the other is roasted
    // separately and combined after.
    cell: ({ row }) => humanize(row.original.blendType),
  },
  {
    id: "roast",
    header: "Roast",
    meta: { label: "Roast" },
    cell: ({ row }) => (
      <span className="flex items-center gap-1.5">
        {row.original.roastLevel ? humanize(row.original.roastLevel) : "—"}
        {/* Decaf is called out because it decides the roast ORDER: decaf runs
            last regardless of how light it is. */}
        {row.original.isDecaf ? <Badge variant="secondary">Decaf</Badge> : null}
      </span>
    ),
  },
  {
    accessorKey: "targetWeightLossPct",
    header: "Target loss",
    meta: { label: "Target loss", align: "end" },
    cell: ({ row }) => formatPercent(row.original.targetWeightLossPct, 2),
  },
  {
    id: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.isActive ? "active" : "disabled"} />,
  },
];

function Blends() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Blend>("inventory.blend.listBlends", search, {
    blendType: search.status || undefined,
  });

  return (
    <ListPage
      title="Blends"
      description="Recipes, and the roast order they imply."
      searchPlaceholder="Search blends"
      search={search}
      query={query}
      filters={(update) => (
        // Pre-roast and post-roast are the most consequential distinction on
        // this page, and the difference was explained only in a code comment.
        <ListFilter
          id="blend-type"
          label="Filter by blend type"
          value={search.status}
          options={[
            { value: "pre_roast", label: "Pre-roast" },
            { value: "post_roast", label: "Post-roast" },
          ]}
          allLabel="Any type"
          onChange={(blendType) => update({ status: blendType, cursor: "" })}
        />
      )}
      actions={
        <Button size="sm" asChild>
          <Link to="/inventory/blends/new">
            <Plus className="size-3.5" aria-hidden="true" />
            New blend
          </Link>
        </Button>
      }
      table={{
        columns,
        rowKey: (row) => row.id,
        empty: "No blends yet.",
      }}
    />
  );
}
