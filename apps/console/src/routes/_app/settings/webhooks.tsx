import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  Input,
  Label,
  PageHeader,
  rpc,
  rpcMutate,
  StatusBadge,
} from "@roastery/ui";
import { formatRelative } from "@roastery/units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { AlertTriangle, Copy, Plus, Webhook } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_app/settings/webhooks")({ component: Webhooks });

type Endpoint = {
  id: string;
  url: string;
  description: string | null;
  eventTypes: string[];
  status: string;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  disabledReason: string | null;
  previousSecretExpiresAt: string | null;
};

type Delivery = {
  id: string;
  endpointId: string;
  eventType: string;
  status: string;
  attempt: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  createdAt: string;
};

const deliveryColumns: ColumnDef<Delivery>[] = [
  {
    accessorKey: "eventType",
    header: "Event",
    meta: { label: "Event" },
    cell: ({ row }) => <span className="font-mono text-xs">{row.original.eventType}</span>,
  },
  {
    accessorKey: "status",
    header: "Status",
    meta: { label: "Status" },
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  },
  { accessorKey: "attempt", header: "Attempt", meta: { label: "Attempt", align: "end" } },
  {
    accessorKey: "lastStatusCode",
    header: "Code",
    meta: { label: "HTTP code", align: "end" },
    cell: ({ row }) => row.original.lastStatusCode ?? "—",
  },
  {
    accessorKey: "lastError",
    header: "Error",
    meta: { label: "Error" },
    // The reason a delivery failed is the whole point of this screen; a status
    // code alone rarely explains a 500 on somebody else's server.
    cell: ({ row }) => (
      <span className="text-muted-foreground text-xs">{row.original.lastError ?? "—"}</span>
    ),
  },
  {
    accessorKey: "nextAttemptAt",
    header: "Next try",
    meta: { label: "Next attempt", align: "end" },
    cell: ({ row }) =>
      row.original.nextAttemptAt ? formatRelative(row.original.nextAttemptAt) : "—",
  },
];

function Webhooks() {
  const { can } = useWorkspace();
  const queryClient = useQueryClient();
  const [url, setUrl] = React.useState("");
  const [secret, setSecret] = React.useState<string | null>(null);

  const endpoints = useQuery({
    queryKey: ["webhooks.listEndpoints"],
    queryFn: () => rpc<{ items: Endpoint[] }>("webhooks.listEndpoints", { page: { limit: 50 } }),
  });

  const deliveries = useQuery({
    queryKey: ["webhooks.listDeliveries"],
    queryFn: () => rpc<{ items: Delivery[] }>("webhooks.listDeliveries", { page: { limit: 50 } }),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["webhooks.listEndpoints"] });
    void queryClient.invalidateQueries({ queryKey: ["webhooks.listDeliveries"] });
  };

  const create = useMutation({
    mutationFn: () =>
      rpcMutate<Endpoint & { secret: string }>("webhooks.createEndpoint", { url: url.trim() }),
    onSuccess: (result) => {
      // Shown ONCE. It is stored encrypted and there is no way to read it back
      // — an integrator who loses it rotates rather than retrieves.
      setSecret(result.secret);
      setUrl("");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not create that endpoint"),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "disabled" }) =>
      rpcMutate("webhooks.updateEndpoint", { id, status }),
    onSuccess: () => {
      toast.success("Endpoint updated");
      invalidate();
    },
  });

  const items = endpoints.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Webhooks"
        description="Where committed changes are delivered, and what happened to each attempt."
      />

      {secret ? (
        <Alert>
          <Webhook className="size-4" aria-hidden="true" />
          <AlertTitle>Copy this signing secret now</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              It is stored encrypted and cannot be shown again. If you lose it, rotate the endpoint
              rather than asking us for it.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-sm bg-muted px-2 py-1 font-mono text-xs">
                {secret}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(secret);
                  toast.success("Copied");
                }}
              >
                <Copy className="size-3.5" aria-hidden="true" />
                Copy
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>
                Done
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}

      {can("webhooks.write") ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Add an endpoint</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                create.mutate();
              }}
            >
              <div className="min-w-64 flex-1 space-y-1.5">
                <Label htmlFor="url">URL</Label>
                <Input
                  id="url"
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/hooks/roastery"
                  required
                />
              </div>
              <Button type="submit" disabled={create.isPending || !url.trim()}>
                <Plus className="size-3.5" aria-hidden="true" />
                Add
              </Button>
            </form>
            <p className="mt-2 text-muted-foreground text-xs">
              {/* https only: a signature proves who sent a payload, not that
                  nobody read it in transit. */}
              Must be https. Subscribes to every event type by default, including ones added later.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Endpoints</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState
              icon={Webhook}
              title="No endpoints yet"
              description="Add one to receive events as they commit."
              className="border-0"
            />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((endpoint) => (
                <li key={endpoint.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm">{endpoint.url}</div>
                    <div className="text-muted-foreground text-xs">
                      {endpoint.eventTypes.length === 0
                        ? "All event types"
                        : `${endpoint.eventTypes.length} subscription${endpoint.eventTypes.length === 1 ? "" : "s"}`}
                      {endpoint.lastSuccessAt
                        ? ` · last delivered ${formatRelative(endpoint.lastSuccessAt)}`
                        : " · never delivered"}
                    </div>
                    {/* auto_disabled is distinct from disabled: one is a
                        decision somebody made, the other is a self-inflicted
                        outage, and they need different words. */}
                    {endpoint.status === "auto_disabled" ? (
                      <div className="mt-1 flex items-center gap-1.5 text-destructive text-xs">
                        <AlertTriangle className="size-3" aria-hidden="true" />
                        {endpoint.disabledReason ?? "Disabled after repeated failures"}
                      </div>
                    ) : null}
                  </div>

                  <StatusBadge status={endpoint.status} />

                  {can("webhooks.write") ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setStatus.mutate({
                          id: endpoint.id,
                          status: endpoint.status === "active" ? "disabled" : "active",
                        })
                      }
                      disabled={setStatus.isPending}
                    >
                      {endpoint.status === "active" ? "Disable" : "Re-enable"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent deliveries</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={deliveries.data?.items ?? []}
            columns={deliveryColumns}
            isLoading={deliveries.isLoading}
            rowKey={(row) => row.id}
            empty="No deliveries yet."
          />
        </CardContent>
      </Card>
    </div>
  );
}
