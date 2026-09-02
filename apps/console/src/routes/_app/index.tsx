import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Metric,
  PageHeader,
  rpc,
  Skeleton,
  StatusBadge,
} from "@roastery/ui";
import { formatDate, formatMoney, formatWeight } from "@roastery/units";
import { useQueries } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Coffee, Flame, type LucideIcon, Package } from "lucide-react";
import type * as React from "react";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_app/")({ component: Dashboard });

type GreenLot = {
  id: string;
  name: string;
  lotCode: string;
  currentWeightKg: string;
  status: string;
};
type RoastBatch = {
  id: string;
  batchNumber: string;
  status: string;
  dropWeightKg: string | null;
  startedAt: string | null;
};
type Alert = {
  ruleId: string;
  subjectId: string;
  severity: "info" | "warning" | "critical";
  message: string;
  notifiedAt: string | null;
};
type Order = {
  id: string;
  orderNumber: string;
  status: string;
  total: string;
  currency: string;
  requestedShipAt: string | null;
};

function Dashboard() {
  const { org, can } = useWorkspace();

  // One `useQueries` rather than three hooks, so these read in parallel and a
  // slow one does not serialize behind a fast one.
  const [lots, batches, orders, alerts] = useQueries({
    queries: [
      {
        queryKey: ["dashboard.greenLots", org?.orgId],
        queryFn: () =>
          rpc<{ items: GreenLot[] }>("inventory.green.listGreenLots", { page: { limit: 5 } }),
        enabled: Boolean(org) && can("inventory.green.read"),
      },
      {
        queryKey: ["dashboard.batches", org?.orgId],
        queryFn: () =>
          rpc<{ items: RoastBatch[] }>("production.roast.listRoastBatches", { page: { limit: 5 } }),
        enabled: Boolean(org) && can("production.roast.read"),
      },
      {
        queryKey: ["dashboard.orders", org?.orgId],
        queryFn: () =>
          rpc<{ items: Order[] }>("orders.listOrders", {
            filter: { openOnly: true },
            page: { limit: 5 },
          }),
        enabled: Boolean(org) && can("orders.read"),
      },
      {
        queryKey: ["dashboard.alerts", org?.orgId],
        queryFn: () =>
          rpc<{ items: Alert[]; counts: { critical: number; warning: number } }>(
            "alerts.listAlerts",
            {},
          ),
        enabled: Boolean(org) && can("alerts.read"),
      },
    ],
  });

  const greenTotal = (lots.data?.items ?? []).reduce(
    (sum, lot) => sum + Number.parseFloat(lot.currentWeightKg ?? "0"),
    0,
  );
  const inProgress = (batches.data?.items ?? []).filter((b) => b.status === "in_progress");

  return (
    <div className="space-y-6">
      <PageHeader
        title={org?.orgName ?? "Dashboard"}
        description="What is happening right now, and what needs a decision."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* The unit comes from the formatter, not from a hardcoded label.
            `formatWeight` picks a natural unit — 4,337 kg reads better as
            4.34 t — and pairing that with a fixed "kg" suffix reported four
            tonnes of coffee as four kilograms. */}
        <Metric
          label="Green on hand"
          value={lots.isLoading ? "—" : formatWeight(String(greenTotal))}
          hint="Across the five most recent lots"
        />
        <Metric
          label="Roasting now"
          value={batches.isLoading ? "—" : inProgress.length}
          hint={inProgress.length === 1 ? "1 batch in progress" : `${inProgress.length} batches`}
        />
        <Metric
          label="Open orders"
          value={orders.isLoading ? "—" : (orders.data?.items.length ?? 0)}
          hint="Confirmed, not yet fulfilled"
        />
        <Metric
          label="Needs attention"
          value={alerts.isLoading ? "—" : (alerts.data?.items.length ?? 0)}
          hint={
            alerts.data?.counts.critical
              ? `${alerts.data.counts.critical} critical`
              : "Nothing overdue"
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PanelCard
          title="Recent green lots"
          icon={Package}
          to="/inventory"
          isLoading={lots.isLoading}
          isEmpty={(lots.data?.items.length ?? 0) === 0}
          emptyLabel="No green coffee registered yet."
        >
          {(lots.data?.items ?? []).map((lot) => (
            <Row
              key={lot.id}
              primary={lot.name}
              secondary={lot.lotCode}
              value={formatWeight(lot.currentWeightKg)}
              badge={<StatusBadge status={lot.status} />}
            />
          ))}
        </PanelCard>

        <PanelCard
          title="Recent roasts"
          icon={Flame}
          to="/roasting"
          isLoading={batches.isLoading}
          isEmpty={(batches.data?.items.length ?? 0) === 0}
          emptyLabel="No roast batches yet."
        >
          {(batches.data?.items ?? []).map((batch) => (
            <Row
              key={batch.id}
              primary={batch.batchNumber}
              secondary={formatDate(batch.startedAt)}
              value={batch.dropWeightKg ? formatWeight(batch.dropWeightKg) : "—"}
              badge={<StatusBadge status={batch.status} />}
            />
          ))}
        </PanelCard>

        <PanelCard
          title="Open orders"
          icon={Coffee}
          to="/orders"
          isLoading={orders.isLoading}
          isEmpty={(orders.data?.items.length ?? 0) === 0}
          emptyLabel="Nothing outstanding."
        >
          {(orders.data?.items ?? []).map((order) => (
            <Row
              key={order.id}
              primary={order.orderNumber}
              secondary={
                order.requestedShipAt
                  ? `Ships ${formatDate(order.requestedShipAt)}`
                  : "No ship date"
              }
              value={formatMoney(order.total, order.currency)}
              badge={<StatusBadge status={order.status} />}
            />
          ))}
        </PanelCard>

        <PanelCard
          title="Needs attention"
          icon={AlertTriangle}
          // No link: these span contracts, green coffee and materials, and
          // sending all three to one of them would be wrong twice.
          isLoading={alerts.isLoading}
          isEmpty={(alerts.data?.items.length ?? 0) === 0}
          emptyLabel="Nothing overdue or below minimum."
        >
          {/* Critical first, then by rule, so an overdue milestone is never
              below a material that is merely at its reorder point. */}
          {[...(alerts.data?.items ?? [])]
            .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
            .slice(0, 5)
            .map((alert) => (
              <Row
                key={`${alert.ruleId}:${alert.subjectId}`}
                primary={alert.message}
                secondary={
                  // Saying whether it was already emailed stops the console
                  // and the digest looking like two disagreeing systems.
                  alert.notifiedAt ? `Digest sent ${formatDate(alert.notifiedAt)}` : "Not yet sent"
                }
                value=""
                badge={<StatusBadge status={alert.severity} />}
              />
            ))}
        </PanelCard>
      </div>
    </div>
  );
}

const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 } as const;

function PanelCard({
  title,
  icon: Icon,
  to,
  isLoading,
  isEmpty,
  emptyLabel,
  children,
}: {
  title: string;
  icon: LucideIcon;
  /** Omitted where no single destination is right for the panel's contents. */
  to?: string;
  isLoading: boolean;
  isEmpty: boolean;
  emptyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </CardTitle>
        {to ? (
          <Link to={to} className="text-muted-foreground text-xs hover:text-foreground">
            View all
          </Link>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState title={emptyLabel} className="border-0 py-8" />
        ) : (
          <div className="divide-y divide-border">{children}</div>
        )}
      </CardContent>
    </Card>
  );
}

function Row({
  primary,
  secondary,
  value,
  badge,
}: {
  primary: string;
  secondary: string;
  value: string;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-2 text-sm">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{primary}</div>
        <div className="truncate text-muted-foreground text-xs">{secondary}</div>
      </div>
      {badge}
      <div className="w-24 shrink-0 text-right font-mono tabular-nums">{value}</div>
    </div>
  );
}
