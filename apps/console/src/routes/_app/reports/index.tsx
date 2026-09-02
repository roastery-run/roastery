import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  PageHeader,
  rpc,
  rpcMutate,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
} from "@roastery/ui";
import { formatDateTime, formatNumber, humanize } from "@roastery/units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Download, FileText } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_app/reports/")({ component: Reports });

type Report = {
  id: string;
  kind: string;
  status: string;
  title: string;
  contentType: string | null;
  sizeBytes: string | null;
  error: string | null;
  completedAt: string | null;
  createdAt: string;
};

const KINDS = [
  "inventory_valuation",
  "production_summary",
  "quality_summary",
  "cafe_performance",
] as const;

function Reports() {
  const { can } = useWorkspace();
  const queryClient = useQueryClient();
  const [kind, setKind] = React.useState<string>("inventory_valuation");

  const reports = useQuery({
    queryKey: ["reporting.listReports"],
    queryFn: () => rpc<{ items: Report[] }>("reporting.listReports", { page: { limit: 50 } }),
    // A queued report becomes ready in the background, so the list has to
    // notice on its own rather than waiting for a refresh.
    refetchInterval: (query) =>
      (query.state.data?.items ?? []).some((r) => r.status === "queued" || r.status === "rendering")
        ? 2000
        : false,
  });

  const generate = useMutation({
    mutationFn: () => rpcMutate<Report>("reporting.generateReport", { kind, parameters: {} }),
    onSuccess: () => {
      toast.success("Report queued", { description: "It will appear below when it is ready." });
      void queryClient.invalidateQueries({ queryKey: ["reporting.listReports"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not queue that report"),
  });

  const download = useMutation({
    mutationFn: (id: string) =>
      rpcMutate<{ url: string }>("reporting.getDownloadUrl", { id, expiresInSeconds: 900 }),
    onSuccess: (result) => {
      // A short-lived signed link, opened rather than embedded. The URL stops
      // working, which is the difference between sharing a document and
      // publishing one.
      window.open(result.url, "_blank", "noopener,noreferrer");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not create a download link"),
  });

  const columns: ColumnDef<Report>[] = [
    { accessorKey: "title", header: "Report", meta: { label: "Report" } },
    {
      accessorKey: "kind",
      header: "Kind",
      meta: { label: "Kind" },
      cell: ({ row }) => humanize(row.original.kind),
    },
    {
      accessorKey: "status",
      header: "Status",
      meta: { label: "Status" },
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <StatusBadge status={row.original.status} />
          {row.original.error ? (
            <span className="text-destructive text-xs">{row.original.error}</span>
          ) : null}
        </span>
      ),
    },
    {
      accessorKey: "sizeBytes",
      header: "Size",
      meta: { label: "Size", align: "end" },
      cell: ({ row }) =>
        row.original.sizeBytes
          ? `${formatNumber(Number(row.original.sizeBytes) / 1024, { digits: 1 })} kB`
          : "—",
    },
    {
      accessorKey: "completedAt",
      header: "Ready",
      meta: { label: "Ready", align: "end" },
      cell: ({ row }) => formatDateTime(row.original.completedAt),
    },
    {
      id: "download",
      header: "",
      meta: { label: "Download", align: "end" },
      cell: ({ row }) =>
        row.original.status === "ready" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => download.mutate(row.original.id)}
            disabled={download.isPending}
          >
            <Download className="size-3.5" aria-hidden="true" />
            Download
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Generated in the background, downloaded through a link that expires."
      />

      {can("reporting.read") ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Generate</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {humanize(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => generate.mutate()} disabled={generate.isPending}>
              <FileText className="size-3.5" aria-hidden="true" />
              Generate
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={reports.data?.items ?? []}
            columns={columns}
            isLoading={reports.isLoading}
            rowKey={(row) => row.id}
            empty="No reports generated yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
