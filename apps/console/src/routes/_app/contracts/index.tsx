import { StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDate, formatMoney, formatWeight, humanize } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/contracts/")({
  validateSearch: tableSearchSchema,
  component: Contracts,
});

type Contract = {
  id: string;
  contractNumber: string;
  status: string;
  contractType: string;
  currency: string;
  totalWeightKg: string | null;
  totalValue: string | null;
  signedAt: string | null;
  createdAt: string;
};

const columns: ColumnDef<Contract>[] = [
  {
    accessorKey: "contractNumber",
    header: "Contract",
    meta: { label: "Contract" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.contractNumber}</span>,
  },
  {
    accessorKey: "contractType",
    header: "Type",
    meta: { label: "Type" },
    // Spot, forward and differential contracts price completely differently;
    // the type is not decoration.
    cell: ({ row }) => humanize(row.original.contractType),
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  {
    accessorKey: "totalWeightKg",
    header: "Weight",
    meta: { label: "Weight", align: "end", unit: "kg" },
    cell: ({ row }) => formatWeight(row.original.totalWeightKg, { unit: "kg", withUnit: false }),
  },
  {
    accessorKey: "totalValue",
    header: "Value",
    meta: { label: "Value", align: "end" },
    cell: ({ row }) => formatMoney(row.original.totalValue, row.original.currency),
  },
  {
    accessorKey: "signedAt",
    header: "Signed",
    meta: { label: "Signed", sortKey: "createdAt", align: "end" },
    cell: ({ row }) => formatDate(row.original.signedAt),
  },
];

function Contracts() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Contract>("sourcing.contract.listContracts", search, {
    status: search.status || undefined,
  });

  return (
    <ListPage
      title="Green contracts"
      description="What has been bought, and what is still to arrive."
      searchPlaceholder="Search contracts"
      search={search}
      query={query}
      table={{
        columns,
        rowKey: (row) => row.id,
        empty: "No contracts yet.",
      }}
    />
  );
}
