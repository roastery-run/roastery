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
  const [lots, batches, orders] = useQueries({
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
          label="Your role"
          value={<span className="text-lg">{org?.roleSlug ?? "—"}</span>}
          hint="In this organization"
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

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="size-4 text-muted-foreground" aria-hidden="true" />
              Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm">
              Overdue contract milestones and lots approaching their minimum appear here once the
              daily scan has run.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

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
  to: string;
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
        <Link to={to} className="text-muted-foreground text-xs hover:text-foreground">
          View all
        </Link>
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
