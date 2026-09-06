import {
  parseFilter,
  StatusBadge,
  serializeFilter,
  tableSearchSchema,
  withSearchDefaults,
} from "@roastery/ui";
import { formatNumber, humanize } from "@roastery/units";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { CreateMaterial } from "@/components/inventory/create-material";
import { ListFilter, optionsFrom } from "@/components/list-filter";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_app/inventory/materials")({
  validateSearch: tableSearchSchema,
  component: Materials,
});

type Material = {
  id: string;
  name: string;
  sku: string;
  kind: string;
  currentQuantity: string;
  minQuantity: string | null;
  unitCost: string | null;
  isActive: boolean;
};

const columns: ColumnDef<Material>[] = [
  {
    accessorKey: "name",
    header: "Material",
    meta: { label: "Material" },
    cell: ({ row }) => (
      <Link
        to="/inventory/materials/$materialId"
        params={{ materialId: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "sku",
    header: "SKU",
    meta: { label: "SKU" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.sku}</span>,
  },
  {
    accessorKey: "kind",
    header: "Kind",
    meta: { label: "Kind" },
    cell: ({ row }) => humanize(row.original.kind),
  },
  {
    accessorKey: "currentQuantity",
    header: "On hand",
    meta: { label: "On hand", align: "end" },
    cell: ({ row }) => {
      const current = Number.parseFloat(row.original.currentQuantity);
      const minimum = row.original.minQuantity ? Number.parseFloat(row.original.minQuantity) : null;
      const low = minimum !== null && current <= minimum;
      return (
        // Below the minimum is called out here rather than only in the daily
        // digest: somebody looking at this list is deciding what to order.
        <span className={low ? "font-medium text-warning" : undefined}>
          {formatNumber(current, { digits: 2 })}
        </span>
      );
    },
  },
  {
    accessorKey: "minQuantity",
    header: "Minimum",
    meta: { label: "Minimum", align: "end" },
    cell: ({ row }) => formatNumber(row.original.minQuantity, { digits: 2 }),
  },
  {
    id: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.isActive ? "active" : "disabled"} />,
  },
];

const MATERIAL_KINDS = [
  "bag",
  "label",
  "valve",
  "box",
  "tin",
  "capsule",
  "tape",
  "insert",
  "merch",
  "other",
] as const;

function Materials() {
  const search = withSearchDefaults(Route.useSearch());
  const { can } = useWorkspace();
  const filters = parseFilter(search.filter);
  const query = useListQuery<Material>("inventory.material.listMaterials", search, {
    kind: search.status || undefined,
    needsReorder: filters.reorder === "1" ? true : undefined,
  });

  return (
    <ListPage
      title="Materials"
      description="Packaging, labels and everything else a finished bag needs."
      searchPlaceholder="Search materials"
      search={search}
      query={query}
      filters={(update) => (
        <>
          {/* The one question this screen exists to answer. It was reachable
              only by reading fifty rows and comparing two numbers per row. */}
          <ListFilter
            id="material-reorder"
            label="Filter by whether stock needs reordering"
            value={filters.reorder ?? ""}
            options={[{ value: "1", label: "Needs reordering" }]}
            allLabel="Any stock level"
            onChange={(value) =>
              update({
                filter: serializeFilter({ ...parseFilter(search.filter), reorder: value }),
                cursor: "",
              })
            }
          />
          {/* `status` carries the kind here: the URL contract has one
              single-value slot per list and a material has no status. */}
          <ListFilter
            id="material-kind"
            label="Filter by kind"
            value={search.status}
            options={optionsFrom(MATERIAL_KINDS)}
            allLabel="Any kind"
            onChange={(kind) => update({ status: kind, cursor: "" })}
          />
        </>
      )}
      actions={<CreateMaterial canWrite={can("inventory.material.write")} />}
      table={{
        columns,
        rowKey: (row) => row.id,
        empty: "No materials yet.",
      }}
    />
  );
}
