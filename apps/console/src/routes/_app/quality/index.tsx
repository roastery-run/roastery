import { Button, StatusBadge, tableSearchSchema, withSearchDefaults } from "@roastery/ui";
import { formatDate, humanize } from "@roastery/units";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { ListPage } from "@/components/list-page";
import { useListQuery } from "@/lib/list-route";

export const Route = createFileRoute("/_app/quality/")({
  validateSearch: tableSearchSchema,
  component: CuppingSessions,
});

type Session = {
  id: string;
  sessionNumber: string;
  name: string;
  mode: string;
  status: string;
  scheduledAt: string | null;
  sampleCount?: number;
};

const columns: ColumnDef<Session>[] = [
  { accessorKey: "name", header: "Session", meta: { label: "Session" } },
  {
    accessorKey: "sessionNumber",
    header: "Number",
    meta: { label: "Number" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.sessionNumber}</span>,
  },
  {
    accessorKey: "mode",
    header: "Protocol",
    meta: { label: "Protocol" },
    // Blind, single-blind and open are different claims about the result, not
    // a display preference.
    cell: ({ row }) => humanize(row.original.mode),
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => (
      <span className="flex items-center gap-2">
        <StatusBadge status={row.original.status} />
        {row.original.status !== "finalized" ? (
          <Link
            to="/cup/$sessionId"
            params={{ sessionId: row.original.id }}
            className="text-primary text-xs hover:underline"
          >
            Score
          </Link>
        ) : null}
      </span>
    ),
  },
  {
    accessorKey: "scheduledAt",
    header: "Scheduled",
    meta: { label: "Scheduled", sortKey: "createdAt", align: "end" },
    cell: ({ row }) => formatDate(row.original.scheduledAt),
  },
];

function CuppingSessions() {
  const search = withSearchDefaults(Route.useSearch());
  const query = useListQuery<Session>("quality.cupping.listCuppingSessions", search, {
    status: search.status || undefined,
  });

  return (
    <ListPage
      title="Cupping sessions"
      description="Panels, their protocol, and the scores each has collected."
      searchPlaceholder="Search sessions"
      search={search}
      query={query}
      actions={
        <Button size="sm">
          <Plus className="size-3.5" aria-hidden="true" />
          New session
        </Button>
      }
      table={{
        columns,
        rowKey: (row) => row.id,
        empty: "No cupping sessions yet.",
      }}
    />
  );
}
