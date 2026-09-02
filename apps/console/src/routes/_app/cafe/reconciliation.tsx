import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  Input,
  Label,
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
import { formatDate, formatPercent } from "@roastery/units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Scale } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

/**
 * Shots pulled against coffee sold.
 *
 * Two observations of the same event, deliberately kept apart. The difference
 * IS the finding: a sale with no shot is a till error or a machine that stopped
 * reporting; a shot with no sale is waste or theft. Merging them at import
 * would erase the question.
 */
export const Route = createFileRoute("/_app/cafe/reconciliation")({ component: Reconciliation });

type Site = { id: string; name: string };

type Reconciliation = {
  id: string;
  siteId: string;
  businessDate: string;
  status: string;
  shotCount: number;
  saleShotEquivalents: number;
  variance: number;
  variancePct: string | null;
  notes: string | null;
  createdAt: string;
};

function Reconciliation() {
  const queryClient = useQueryClient();
  const [siteId, setSiteId] = React.useState<string | undefined>();
  const [businessDate, setBusinessDate] = React.useState(
    new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
  );

  const sites = useQuery({
    queryKey: ["cafe.listSites"],
    queryFn: () => rpc<{ items: Site[] }>("cafe.listSites", { page: { limit: 100 } }),
  });

  const selected = siteId ?? sites.data?.items[0]?.id;
  const siteName = new Map((sites.data?.items ?? []).map((s) => [s.id, s.name]));

  const history = useQuery({
    queryKey: ["cafe.listReconciliations"],
    queryFn: () =>
      rpc<{ items: Reconciliation[] }>("cafe.listReconciliations", { page: { limit: 50 } }),
  });

  const reconcile = useMutation({
    mutationFn: () =>
      rpcMutate<Reconciliation>("cafe.reconcilePos", { siteId: selected, businessDate }),
    onSuccess: (result) => {
      if (result.status === "matched") {
        toast.success("Shots and sales agree", {
          description: `${result.shotCount} shots, ${result.saleShotEquivalents} sold.`,
        });
      } else {
        toast.warning(`Variance of ${result.variance}`, { description: result.notes ?? undefined });
      }
      void queryClient.invalidateQueries({ queryKey: ["cafe.listReconciliations"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not reconcile that day"),
  });

  const columns: ColumnDef<Reconciliation>[] = [
    {
      accessorKey: "businessDate",
      header: "Day",
      meta: { label: "Business date" },
      cell: ({ row }) => formatDate(row.original.businessDate),
    },
    {
      accessorKey: "siteId",
      header: "Site",
      meta: { label: "Site" },
      cell: ({ row }) => siteName.get(row.original.siteId) ?? "—",
    },
    { accessorKey: "shotCount", header: "Shots", meta: { label: "Shots", align: "end" } },
    {
      accessorKey: "saleShotEquivalents",
      header: "Sold",
      meta: { label: "Sold, in shot equivalents", align: "end" },
    },
    {
      accessorKey: "variance",
      header: "Variance",
      meta: { label: "Variance", align: "end" },
      cell: ({ row }) => (
        // Sign carries the meaning: positive is coffee pulled and not sold,
        // negative is sales the machines never reported.
        <span className={row.original.variance === 0 ? "text-muted-foreground" : "text-warning"}>
          {row.original.variance > 0 ? "+" : ""}
          {row.original.variance}
        </span>
      ),
    },
    {
      accessorKey: "variancePct",
      header: "%",
      meta: { label: "Variance percent", align: "end" },
      cell: ({ row }) => formatPercent(row.original.variancePct, 1),
    },
    {
      accessorKey: "status",
      header: "Status",
      meta: { label: "Status" },
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="POS reconciliation"
        description="What the machines pulled, against what the till rang up."
      />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Reconcile a day</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              reconcile.mutate();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="site">Site</Label>
              <Select value={selected} onValueChange={setSiteId}>
                <SelectTrigger id="site" className="w-56">
                  <SelectValue placeholder="Choose a site" />
                </SelectTrigger>
                <SelectContent>
                  {(sites.data?.items ?? []).map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="date">Business date</Label>
              <Input
                id="date"
                type="date"
                value={businessDate}
                onChange={(event) => setBusinessDate(event.target.value)}
              />
            </div>

            <Button type="submit" disabled={reconcile.isPending || !selected}>
              <Scale className="size-3.5" aria-hidden="true" />
              Reconcile
            </Button>
          </form>
          <p className="mt-2 text-muted-foreground text-xs">
            Discarded shots are excluded — a dumped shot was never sellable, so counting it as
            unsold would report the waste twice.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">History</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={history.data?.items ?? []}
            columns={columns}
            isLoading={history.isLoading}
            rowKey={(row) => row.id}
            empty="No days reconciled yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
