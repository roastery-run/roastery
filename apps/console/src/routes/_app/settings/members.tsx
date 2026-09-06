import { Badge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDate } from "@roastery/units";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/settings/members")({
  validateSearch: tableSearchSchema,
  component: Members,
});

type Member = {
  userId: string;
  name: string | null;
  email: string;
  roleSlug: string;
  createdAt: string;
};

const columns: ColumnDef<Member>[] = [
  {
    accessorKey: "name",
    header: "Name",
    meta: { label: "Name" },
    cell: ({ row }) => row.original.name ?? "—",
  },
  { accessorKey: "email", header: "Email", meta: { label: "Email" } },
  {
    accessorKey: "roleSlug",
    header: "Role",
    meta: { label: "Role" },
    // The role decides what they can do; it is the reason this screen exists.
    cell: ({ row }) => <Badge variant="secondary">{row.original.roleSlug}</Badge>,
  },
  {
    accessorKey: "createdAt",
    header: "Joined",
    meta: { label: "Joined", sortKey: "createdAt", align: "end" },
    cell: ({ row }) => formatDate(row.original.createdAt),
  },
];

function Members() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Member>("console.listMembers", search);

  return (
    <ListPage
      title="Members"
      description="Who can act in this organization, and as what."
      searchPlaceholder="Search members"
      search={search}
      query={query}
      table={{
        columns,
        rowKey: (row) => row.userId,
        empty: "No members.",
      }}
    />
  );
}
