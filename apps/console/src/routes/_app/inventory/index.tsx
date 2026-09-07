import {
  Button,
  parseFilter,
  StatusBadge,
  serializeFilter,
  tableSearchSchema,
  withSearchDefaults,
} from "@roastery/ui";
import { formatDate, formatWeight, humanize } from "@roastery/units";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { ListFilter, optionsFrom } from "@/components/list-filter";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/inventory/")({
  validateSearch: tableSearchSchema,
  component: GreenLots,
});

type GreenLot = {
  id: string;
  name: string;
  lotCode: string;
  status: string;
  processMethod: string | null;
  harvestYear: number | null;
  currentWeightKg: string;
  reservedWeightKg: string;
  bagWeightKg: string | null;
  registeredAt: string;
};

const columns: ColumnDef<GreenLot>[] = [
  {
    accessorKey: "name",
    header: "Lot",
    meta: { label: "Lot" },
    cell: ({ row }) => (
      <Link
        to="/inventory/$lotId"
        params={{ lotId: row.original.id }}
        className="font-medium hover:underline"
      >
        {row.original.name}
      </Link>
    ),
  },
  {
    accessorKey: "lotCode",
    header: "Code",
    meta: { label: "Code" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.lotCode}</span>,
  },
  {
    accessorKey: "processMethod",
    header: "Process",
    meta: { label: "Process" },
    cell: ({ row }) => humanize(row.original.processMethod),
  },
  {
    accessorKey: "harvestYear",
    header: "Harvest",
    meta: { label: "Harvest", align: "end" },
    cell: ({ row }) => row.original.harvestYear ?? "—",
  },
  {
    accessorKey: "currentWeightKg",
    header: "On hand",
    // The unit is PINNED and lives on the column, not in the cell. Left to
    // choose, `formatWeight` switches to tonnes above 1,000 kg, so a lot at
    // 995 and one at 1,005 rendered "995.00 kg" and "1.01 mt" one row apart —
    // and the misread is confident, which is worse than an obvious one.
    meta: { label: "On hand", align: "end", unit: "kg" },
    cell: ({ row }) => formatWeight(row.original.currentWeightKg, { unit: "kg", withUnit: false }),
  },
  {
    // Shown next to the total rather than netted off it: an operator needs to
    // know both what is physically there and what is already promised, and a
    // single "available" figure hides the difference.
    accessorKey: "reservedWeightKg",
    header: "Reserved",
    meta: { label: "Reserved", align: "end", unit: "kg" },
    cell: ({ row }) => formatWeight(row.original.reservedWeightKg, { unit: "kg", withUnit: false }),
  },
  {
    id: "bags",
    header: "Bags",
    meta: { label: "Bags", align: "end" },
    // Bags only where the lot records its own bag weight. A default would
    // misreport a Colombian lot by 17% against a Brazilian one.
    cell: ({ row }) =>
      row.original.bagWeightKg ? (
        formatWeight(row.original.currentWeightKg, {
          unit: "bag",
          context: { bagWeightKg: row.original.bagWeightKg },
        })
      ) : (
        // A dash here is a refusal, not missing data, and the two look
        // identical in a column. Saying which is the difference between a
        // person moving on and a person going to look for the number.
        <span title="This lot has no bag weight recorded, so it cannot be counted in bags.">—</span>
      ),
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "registeredAt",
    header: "Registered",
    meta: { label: "Registered", align: "end", sortKey: "registeredAt" },
    cell: ({ row }) => formatDate(row.original.registeredAt),
  },
];

/** The API's own `lotStatusSchema`, in the order a person reasons about it. */
const LOT_STATUSES = [
  "available",
  "reserved",
  "quarantined",
  "in_transit",
  "spot",
  "projected",
  "depleted",
  "archived",
] as const;

function GreenLots() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<GreenLot>("inventory.green.listGreenLots", search, {
    status: search.status || undefined,
    belowMinimum: parseFilter(search.filter).below === "1" ? true : undefined,
  });

  return (
    <ListPage
      title="Green coffee"
      description="Every lot, what is on hand, and what is already promised."
      searchPlaceholder="Search lots"
      search={search}
      query={query}
      actions={
        <Button size="sm" asChild>
          <Link to="/inventory/import">
            <Plus className="size-3.5" aria-hidden="true" />
            Import lot
          </Link>
        </Button>
      }
      filters={(update) => (
        <>
          <ListFilter
            id="lot-status"
            label="Filter by status"
            value={search.status}
            options={optionsFrom(LOT_STATUSES)}
            allLabel="Any status"
            onChange={(status) => update({ status, cursor: "" })}
          />
          {/* The import form promises "Alerts when the lot falls to this
              weight" as somebody types a reorder point. This is the screen
              where that promise is either kept or is decoration. */}
          <ListFilter
            id="lot-stock"
            label="Filter by stock level"
            value={parseFilter(search.filter).below ?? ""}
            options={[{ value: "1", label: "At or below reorder point" }]}
            allLabel="Any stock level"
            onChange={(value) =>
              update({
                filter: serializeFilter({ ...parseFilter(search.filter), below: value }),
                cursor: "",
              })
            }
          />
        </>
      )}
      table={{
        columns,
        rowKey: (row) => row.id,
        empty: "No green coffee yet. Import a lot or receive a contract shipment.",
      }}
    />
  );
}
