import { Badge, Button, cn, rpc, rpcMutate } from "@roastery/ui";
import { TimeSeriesChart } from "@roastery/ui/charts";
import { formatElapsed, formatTemperature } from "@roastery/units";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import * as React from "react";
import { toast } from "sonner";
import { FocusShell } from "@/components/focus-shell";
import { useLiveRoast } from "@/hooks/use-live-roast";
import { requireAuth } from "@/lib/require-auth";
import { useWorkspace } from "@/lib/workspace";

/**
 * The live roast screen.
 *
 * A FocusShell: no sidebar, 44 px targets, a wake lock held. A roaster watches
 * this for twelve minutes without touching it, standing, sometimes with a
 * glove on, on a panel PC at 1024×768.
 */
/**
 * Deliberately OUTSIDE the `_app` layout.
 *
 * FocusShell replaces AppShell rather than sitting inside it — no sidebar, no
 * org switcher, 44 px targets, wake lock held. Nesting it under `_app` would
 * render one shell inside the other.
 */
export const Route = createFileRoute("/roast/$batchId")({
  beforeLoad: ({ context, location }) => requireAuth(context, location.pathname),
  component: LiveRoast,
});

type Batch = { id: string; batchNumber: string; status: string; chargeWeightKg: string | null };

/** The marks a roaster calls, in the order they happen. */
const MARKS = [
  { kind: "dry_end", label: "Dry end", hint: "D" },
  { kind: "first_crack", label: "First crack", hint: "F" },
  { kind: "second_crack", label: "Second crack", hint: "S" },
] as const;

function LiveRoast() {
  const { batchId } = Route.useParams();
  const { org } = useWorkspace();
  const navigate = useNavigate();

  const batch = useQuery({
    queryKey: ["production.roast.getRoastBatch", batchId],
    queryFn: () => rpc<Batch>("production.roast.getRoastBatch", { id: batchId }),
  });

  const live = useLiveRoast(batchId, org?.orgId ?? null);

  const recordMark = (kind: string) => {
    if (!live.mark(kind)) {
      toast.error("Not connected", {
        description: "The mark was not recorded. Reconnecting…",
      });
    }
  };

  const complete = useMutation({
    mutationFn: (dropWeightKg: string) =>
      rpcMutate("production.roast.completeRoastBatch", { id: batchId, dropWeightKg }),
    onSuccess: () => {
      toast.success("Roast completed");
      void navigate({ to: "/roasting/$batchId", params: { batchId } });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not complete"),
  });

  // Keyboard marks. A roaster's hands are busy and the screen may be out of
  // reach; a single key is the fastest input there is.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      const found = MARKS.find((m) => m.hint.toLowerCase() === event.key.toLowerCase());
      if (found) {
        event.preventDefault();
        recordMark(found.kind);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const { readout, status, marks } = live;
  const sampleCount = readout.sampleCount;

  // Copied out of the ref only for the chart, and only for the samples that
  // exist — not the 4,096-slot capacity.
  const chartData = React.useMemo(() => {
    const s = live.series;
    const n = s.length;
    const toArray = (source: Float64Array) =>
      Array.from(source.subarray(0, n), (v) => (Number.isFinite(v) ? v : null));
    return {
      t: Array.from(s.t.subarray(0, n)),
      bt: toArray(s.bt),
      et: toArray(s.et),
      ror: toArray(s.ror),
    };
    // Keyed on `revision`, which the hook bumps at 4 Hz — not on the arrays,
    // which are mutated in place and would never look different to React.
    // biome-ignore lint/correctness/useExhaustiveDependencies: revision is the change signal.
  }, [live.revision, live.series]);

  return (
    <FocusShell
      title={batch.data?.batchNumber ?? "Live roast"}
      subtitle={
        <span className="flex items-center gap-2">
          <ConnectionPill status={status} />
          <span>{sampleCount} samples</span>
        </span>
      }
      actions={
        <Button
          size="lg"
          onClick={() => {
            const entered = window.prompt("Drop weight in kilograms");
            if (entered) complete.mutate(entered);
          }}
          disabled={complete.isPending || readout.state === "complete"}
        >
          Drop
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Reading label="Time" value={formatElapsed(readout.elapsedSeconds)} live />
            <Reading label="Bean" value={formatTemperature(readout.beanTempC)} live />
            <Reading label="Environment" value={formatTemperature(readout.envTempC)} />
            <Reading
              label="Rate of rise"
              value={readout.rorCPerMin === null ? "—" : `${readout.rorCPerMin.toFixed(1)} °C/min`}
              live
            />
          </div>

          {sampleCount > 1 ? (
            <TimeSeriesChart
              title={`Live curve for ${batch.data?.batchNumber ?? "this batch"}`}
              description="Bean and environment temperature with rate of rise."
              x={chartData.t}
              formatX={(seconds) => formatElapsed(seconds)}
              xLabel="Time since charge"
              height={380}
              series={[
                { label: "Bean", values: chartData.bt, unit: "°C", colorIndex: 0 },
                { label: "Environment", values: chartData.et, unit: "°C", colorIndex: 1 },
                // Its own axis: RoR runs −200 to +40 while bean runs 90 to 220.
                {
                  label: "Rate of rise",
                  values: chartData.ror,
                  unit: "°C/min",
                  colorIndex: 2,
                  axis: "right",
                },
              ]}
            />
          ) : (
            <div className="grid h-[380px] place-items-center rounded-2xl border border-border border-dashed text-muted-foreground text-sm">
              {status === "open"
                ? "Connected. Waiting for the first sample from the machine."
                : "Connecting to the roast…"}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="space-y-2">
            <h2 className="font-medium text-sm">Mark</h2>
            <p className="text-muted-foreground text-xs">
              {/* First crack is a SOUND. It is never inferred from the curve,
                  because the curve does not hear it. */}
              First crack is something you hear. Press the key or the button the moment you hear it.
            </p>
            {MARKS.map((item) => {
              const recorded = marks.find((m) => m.kind === item.kind);
              return (
                <Button
                  key={item.kind}
                  variant={recorded ? "secondary" : "outline"}
                  className="w-full justify-between"
                  onClick={() => recordMark(item.kind)}
                  disabled={Boolean(recorded) || status !== "open"}
                >
                  <span>{item.label}</span>
                  <span className="font-mono text-xs">
                    {recorded ? formatElapsed(recorded.t) : item.hint}
                  </span>
                </Button>
              );
            })}
          </div>

          {marks.length > 0 ? (
            <div className="space-y-1.5">
              <h2 className="font-medium text-sm">Recorded</h2>
              <ul className="space-y-1 text-sm">
                {[...marks]
                  .sort((a, b) => a.t - b.t)
                  .map((event) => (
                    <li
                      key={`${event.kind}-${event.t}`}
                      className="flex justify-between gap-2 tabular-nums"
                    >
                      <span className="text-muted-foreground">{event.kind.replace(/_/g, " ")}</span>
                      <span className="font-mono">{formatElapsed(event.t)}</span>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </FocusShell>
  );
}

/**
 * A live number.
 *
 * Never animates position — a value that slides is a value you cannot read at
 * a glance, and this is read from two metres away while the roaster's hands
 * are busy.
 */
function Reading({ label, value, live }: { label: string; value: string; live?: boolean }) {
  return (
    <div className="rounded-2xl bg-card ring-1 ring-foreground/10 p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        {label}
        {live ? (
          <span
            className="live-pulse inline-block size-1.5 rounded-full bg-primary"
            aria-hidden="true"
          />
        ) : null}
      </div>
      <div className="mt-1 font-mono font-semibold text-3xl tabular-nums">{value}</div>
    </div>
  );
}

function ConnectionPill({ status }: { status: string }) {
  const tone = status === "open" ? "success" : status === "reconnecting" ? "warning" : "secondary";
  return (
    <Badge variant={tone as "success"} className={cn(status === "open" && "live-pulse")}>
      {status === "open" ? "Live" : status === "reconnecting" ? "Reconnecting" : status}
    </Badge>
  );
}
