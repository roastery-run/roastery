import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Metric,
  PageHeader,
  rpc,
  rpcMutate,
  Skeleton,
  StatusBadge,
} from "@roastery/ui";
import { formatDate, formatWeight } from "@roastery/units";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CalendarDays, Flame } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/lib/workspace";

/**
 * The production schedule board.
 *
 * Two halves: what still has to be covered, and the day that would cover it.
 * Generation produces a DRAFT — releasing it is a separate, deliberate act,
 * because a released schedule is what a roaster's morning is built on.
 */
export const Route = createFileRoute("/_app/roasting/schedule")({ component: ScheduleBoard });

type DemandItem = {
  blendId: string | null;
  label: string;
  roastedKg: string;
  dueAt: string | null;
  orderLineCount: number;
};

type ScheduledBatch = {
  id: string;
  machineId: string | null;
  blendId: string | null;
  position: number;
  plannedChargeKg: string;
  plannedYieldKg: string | null;
  demandLineIds: string[];
  roastBatchId: string | null;
};

type Schedule = {
  id: string;
  name: string;
  scheduledDate: string;
  status: string;
  feasibilityNotes: string[];
  batches: ScheduledBatch[];
  createdAt: string;
};

type Machine = { id: string; name: string; code: string };

function ScheduleBoard() {
  const { can } = useWorkspace();
  const queryClient = useQueryClient();
  const [schedule, setSchedule] = React.useState<Schedule | null>(null);

  const demand = useQuery({
    queryKey: ["production.schedule.listDemandAggregate"],
    queryFn: () =>
      rpc<{ items: DemandItem[]; totalRoastedKg: string }>(
        "production.schedule.listDemandAggregate",
        {},
      ),
  });

  const machines = useQuery({
    queryKey: ["catalog.machine.listMachines"],
    queryFn: () =>
      rpc<{ items: Machine[] }>("catalog.machine.listMachines", { page: { limit: 100 } }),
  });

  const machineName = new Map((machines.data?.items ?? []).map((m) => [m.id, m.code]));

  // The scheduler returns blend ids; a roaster needs the name. Resolved here
  // rather than joined server-side because the blend list is small, cached,
  // and already loaded on most other screens.
  const blends = useQuery({
    queryKey: ["inventory.blend.listBlends"],
    queryFn: () =>
      rpc<{ items: { id: string; name: string; roastLevel: string | null; isDecaf: boolean }[] }>(
        "inventory.blend.listBlends",
        { page: { limit: 200 } },
      ),
  });
  const blendById = new Map((blends.data?.items ?? []).map((b) => [b.id, b]));

  const generate = useMutation({
    mutationFn: () =>
      rpcMutate<Schedule>("production.schedule.generateProductionSchedule", {
        name: `Roast day ${new Date().toISOString().slice(0, 10)}`,
        scheduledDate: new Date().toISOString().slice(0, 10),
        maxBatchesPerMachine: 18,
      }),
    onSuccess: (result) => {
      setSchedule(result);
      toast.success("Draft schedule generated", {
        description: `${result.batches.length} batches. Review the notes before releasing.`,
      });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not generate a schedule"),
  });

  const release = useMutation({
    mutationFn: (id: string) =>
      rpcMutate<Schedule>("production.schedule.releaseScheduleToProduction", { id }),
    onSuccess: (result) => {
      setSchedule(result);
      toast.success("Released to the floor");
      void queryClient.invalidateQueries({ queryKey: ["production.roast.listRoastBatches"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not release the schedule"),
  });

  // Grouped by machine, because that is how the day is actually run: each drum
  // works through its own queue in order.
  const byMachine = React.useMemo(() => {
    const groups = new Map<string, ScheduledBatch[]>();
    for (const batch of schedule?.batches ?? []) {
      const key = batch.machineId ?? "unassigned";
      groups.set(key, [...(groups.get(key) ?? []), batch]);
    }
    for (const list of groups.values()) list.sort((a, b) => a.position - b.position);
    return [...groups.entries()];
  }, [schedule]);

  const items = demand.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production schedule"
        description="What is still uncovered, and the roast day that would cover it."
        actions={
          can("production.schedule.write") ? (
            <Button
              onClick={() => generate.mutate()}
              disabled={generate.isPending || !items.length}
            >
              <CalendarDays className="size-3.5" aria-hidden="true" />
              Generate a draft
            </Button>
          ) : null
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Outstanding demand"
          value={demand.isLoading ? "—" : formatWeight(demand.data?.totalRoastedKg)}
          hint="Confirmed orders, less what stock already covers"
        />
        <Metric
          label="Requirements"
          value={demand.isLoading ? "—" : items.length}
          hint="After merging what would be roasted together"
        />
        <Metric
          label="Order lines"
          value={items.reduce((sum, item) => sum + item.orderLineCount, 0)}
          hint="Behind those requirements"
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">What production has to cover</CardTitle>
        </CardHeader>
        <CardContent>
          {demand.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : items.length === 0 ? (
            <EmptyState
              title="Nothing outstanding"
              description="Every confirmed order is covered by stock already on the shelf."
              className="border-0"
            />
          ) : (
            <ul className="divide-y divide-border">
              {items.map((item) => (
                <li key={item.label} className="flex items-center gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{item.label}</div>
                    <div className="text-muted-foreground text-xs">
                      {item.orderLineCount} order line{item.orderLineCount === 1 ? "" : "s"}
                      {item.dueAt ? ` · earliest ${formatDate(item.dueAt)}` : null}
                    </div>
                  </div>
                  <div className="font-mono tabular-nums">{formatWeight(item.roastedKg)}</div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {schedule ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-lg tracking-tight">{schedule.name}</h2>
              <p className="text-muted-foreground text-sm">
                {formatDate(schedule.scheduledDate)} · {schedule.batches.length} batches
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={schedule.status} />
              {schedule.status === "draft" && can("production.schedule.approve") ? (
                <Button onClick={() => release.mutate(schedule.id)} disabled={release.isPending}>
                  Release to the floor
                </Button>
              ) : null}
            </div>
          </div>

          {/* Shortfalls sit ON the plan, above it, before anyone reads the
              batches. A schedule that quietly covers less than was ordered is
              the worst possible output. */}
          {schedule.feasibilityNotes.length > 0 ? (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" aria-hidden="true" />
              <AlertTitle>
                This day does not cover everything ({schedule.feasibilityNotes.length}
                {schedule.feasibilityNotes.length === 1 ? " shortfall" : " shortfalls"})
              </AlertTitle>
              <AlertDescription>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {schedule.feasibilityNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {byMachine.map(([machineId, batches]) => (
              <Card key={machineId}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Flame className="size-4 text-muted-foreground" aria-hidden="true" />
                    {machineName.get(machineId) ?? "Unassigned"}
                    <span className="ml-auto font-normal text-muted-foreground text-xs">
                      {batches.length} batches
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <ol className="divide-y divide-border">
                    {batches.map((batch) => (
                      <li key={batch.id} className="flex items-center gap-3 py-2 text-sm">
                        <span className="w-6 shrink-0 text-right font-mono text-muted-foreground text-xs tabular-nums">
                          {batch.position + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate">
                            {batch.blendId
                              ? (blendById.get(batch.blendId)?.name ?? "Unknown blend")
                              : "Unassigned"}
                          </div>
                          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                            {/* Roast level and decaf are why this batch is in
                                this position: light before dark, decaf last. */}
                            {batch.blendId && blendById.get(batch.blendId)?.roastLevel ? (
                              <span>{blendById.get(batch.blendId)?.roastLevel}</span>
                            ) : null}
                            {batch.blendId && blendById.get(batch.blendId)?.isDecaf ? (
                              <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                                decaf
                              </Badge>
                            ) : null}
                            <span>
                              {batch.demandLineIds.length} line
                              {batch.demandLineIds.length === 1 ? "" : "s"}
                            </span>
                          </div>
                        </div>
                        <div className="text-right font-mono text-xs tabular-nums">
                          <div>{formatWeight(batch.plannedChargeKg)}</div>
                          <div className="text-muted-foreground">
                            → {formatWeight(batch.plannedYieldKg)}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
