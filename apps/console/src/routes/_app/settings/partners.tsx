import { Badge, StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatCountry, humanize } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/settings/partners")({
  validateSearch: tableSearchSchema,
  component: Partners,
});

type Partner = {
  id: string;
  name: string;
  code: string;
  types: string[];
  country: string | null;
  defaultCurrency: string | null;
  paymentTermsDays: number | null;
  isActive: boolean;
};

const columns: ColumnDef<Partner>[] = [
  { accessorKey: "name", header: "Partner", meta: { label: "Partner" } },
  {
    accessorKey: "code",
    header: "Code",
    meta: { label: "Code" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.code}</span>,
  },
  {
    accessorKey: "types",
    header: "Roles",
    meta: { label: "Roles" },
    // A partner is often several things at once — an importer who is also a
    // customer — so this is a list rather than one value.
    cell: ({ row }) => (
      <span className="flex flex-wrap gap-1">
        {row.original.types.map((type) => (
          <Badge key={type} variant="secondary">
            {humanize(type)}
          </Badge>
        ))}
      </span>
    ),
  },
  {
    accessorKey: "country",
    header: "Country",
    meta: { label: "Country" },
    cell: ({ row }) => formatCountry(row.original.country),
  },
  {
    accessorKey: "paymentTermsDays",
    header: "Terms",
    meta: { label: "Payment terms", align: "end" },
    cell: ({ row }) =>
      row.original.paymentTermsDays === null ? "—" : `${row.original.paymentTermsDays} days`,
  },
  {
    id: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.isActive ? "active" : "disabled"} />,
  },
];

function Partners() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Partner>("catalog.party.listPartners", search);

  return (
    <ListPage
      title="Partners"
      description="Importers, exporters, mills and customers."
      searchPlaceholder="Search partners"
      search={search}
      query={query}
      table={{
        columns,
        rowKey: (row) => row.id,
        empty: "No partners yet.",
      }}
    />
  );
}
