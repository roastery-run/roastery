import {
  parseFilter,
  StatusBadge,
  serializeFilter,
  tableSearchSchema,
  withSearchDefaults,
} from "@roastery/ui";
import { formatDate, formatRelative, formatWeight, humanize } from "@roastery/units";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListFilter, optionsFrom } from "@/components/list-filter";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/inventory/roasted")({
  validateSearch: tableSearchSchema,
  component: RoastedLots,
});

type RoastedLot = {
  id: string;
  name: string;
  lotCode: string;
  lotKind: string;
  roastLevel: string | null;
  currentWeightKg: string;
  reservedWeightKg: string;
  bestBeforeAt: string | null;
  status: string;
};

const columns: ColumnDef<RoastedLot>[] = [
  {
    accessorKey: "name",
    header: "Lot",
    meta: { label: "Lot" },
    cell: ({ row }) => (
      <Link
        to="/inventory/roasted/$roastedLotId"
        params={{ roastedLotId: row.original.id }}
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
    accessorKey: "roastLevel",
    header: "Roast",
    meta: { label: "Roast" },
    cell: ({ row }) => humanize(row.original.roastLevel),
  },
  {
    accessorKey: "currentWeightKg",
    header: "On hand",
    meta: { label: "On hand", align: "end", unit: "kg" },
    cell: ({ row }) => formatWeight(row.original.currentWeightKg, { unit: "kg", withUnit: false }),
  },
  {
    accessorKey: "reservedWeightKg",
    header: "Reserved",
    meta: { label: "Reserved", align: "end", unit: "kg" },
    cell: ({ row }) => formatWeight(row.original.reservedWeightKg, { unit: "kg", withUnit: false }),
  },
  {
    accessorKey: "bestBeforeAt",
    header: "Best before",
    // The sort this screen was always about, and the one the API now indexes.
    meta: { label: "Best before", align: "end", sortKey: "bestBeforeAt" },
    /**
     * Roasted coffee ships first-expiry-first-out, so this is the column the
     * screen is really about. It cannot be SORTED — no list operation takes a
     * sort key, and keyset pagination runs on (createdAt, id) — so the urgency
     * is carried by the cell and by the freshness filter instead of by an
     * ordering the API cannot honour.
     *
     * Both dates: the absolute one reconciles against a delivery note, the
     * relative one is the decision.
     */
    cell: ({ row }) => {
      const date = row.original.bestBeforeAt;
      if (!date) return "—";
      const days = daysUntil(date);
      return (
        <span className="inline-flex flex-col items-end leading-tight">
          <span>{formatDate(date)}</span>
          <span
            className={
              days === null
                ? "text-muted-foreground text-xs"
                : days < 0
                  ? "text-destructive text-xs"
                  : days <= STALE_SOON_DAYS
                    ? "text-warning text-xs"
                    : "text-muted-foreground text-xs"
            }
          >
            {/* A shape as well as a colour: this list gets printed for a pick
                round, and greyscale has to carry the same warning. */}
            {days !== null && days < 0
              ? "■ "
              : days !== null && days <= STALE_SOON_DAYS
                ? "▲ "
                : ""}
            {formatRelative(date)}
          </span>
        </span>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
];

/** Two weeks is a pick round, not a shelf life. */
const STALE_SOON_DAYS = 14;

const ROASTED_STATUSES = ["available", "reserved", "depleted", "archived"] as const;

/** The windows a person actually asks for, not an arbitrary number field. */
const FRESHNESS = [
  { value: "7", label: "Within 7 days" },
  { value: "14", label: "Within 14 days" },
  { value: "30", label: "Within 30 days" },
] as const;

function daysUntil(date: string): number | null {
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((then - Date.now()) / 86_400_000);
}

function RoastedLots() {
  const search = withSearchDefaults(Route.useSearch());
  const expiring = parseFilter(search.filter).expiring ?? "";
  const query = useListQuery<RoastedLot>("inventory.roast.listRoastedLots", search, {
    status: search.status || undefined,
    expiringWithinDays: expiring ? Number(expiring) : undefined,
  });

  return (
    <ListPage
      title="Roasted coffee"
      description="Finished stock, and how soon each lot goes stale."
      searchPlaceholder="Search roasted lots"
      search={search}
      query={query}
      filters={(update) => (
        <>
          <ListFilter
            id="roasted-status"
            label="Filter by status"
            value={search.status}
            options={optionsFrom(ROASTED_STATUSES)}
            allLabel="Any status"
            onChange={(status) => update({ status, cursor: "" })}
          />
          <ListFilter
            id="roasted-freshness"
            label="Filter by how soon it goes stale"
            value={expiring}
            options={FRESHNESS}
            allLabel="Any best-before"
            onChange={(value) =>
              update({
                filter: serializeFilter({ ...parseFilter(search.filter), expiring: value }),
                cursor: "",
              })
            }
          />
        </>
      )}
      table={{
        columns,
        rowKey: (row) => row.id,
        empty: "No roasted coffee yet. Complete a roast to create some.",
      }}
    />
  );
}
