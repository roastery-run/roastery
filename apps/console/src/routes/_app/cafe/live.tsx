import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Metric,
  PageHeader,
  rpc,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
} from "@roastery/ui";
import { formatElapsed } from "@roastery/units";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, Coffee } from "lucide-react";
import { z } from "zod";

/**
 * The live bar view.
 *
 * Reads the site's live session, not the database. The point is to answer in
 * seconds — a manager standing at the bar wants to know a group head is
 * channeling now, not on the next rollup.
 */
export const Route = createFileRoute("/_app/cafe/live")({
  validateSearch: z.object({ siteId: z.string().optional().catch(undefined) }),
  component: LiveBar,
});

type Site = { id: string; name: string };

type LiveShot = {
  externalId: string;
  machineId: string;
  groupNumber: number;
  pulledAt: number;
  doseG: number | null;
  yieldG: number | null;
  durationS: number | null;
  ratio: number | null;
  verdict: string;
};

type Anomaly = { kind: string; groupNumber: number; message: string; evidence: number };

type LiveBarData = { siteId: string; watchers: number; shots: LiveShot[]; anomalies: Anomaly[] };

function LiveBar() {
  const { siteId } = Route.useSearch();
  const navigate = useNavigate();

  const sites = useQuery({
    queryKey: ["cafe.listSites"],
    queryFn: () => rpc<{ items: Site[] }>("cafe.listSites", { page: { limit: 100 } }),
  });

  const selected = siteId ?? sites.data?.items[0]?.id;

  const live = useQuery({
    queryKey: ["cafe.getLiveBar", selected],
    queryFn: () => rpc<LiveBarData>("cafe.getLiveBar", { siteId: selected }),
    enabled: Boolean(selected),
    // Polled rather than streamed: a bar produces roughly one shot every few
    // minutes, so a socket per viewer would cost more than it saves. Two
    // seconds still meets the "within five seconds" the alert promises.
    refetchInterval: 2000,
  });

  const shots = live.data?.shots ?? [];
  const anomalies = live.data?.anomalies ?? [];
  const inSpec = shots.filter((s) => s.verdict === "in_spec").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live bar"
        description="The last five minutes, and any group head currently going wrong."
        actions={
          <Select
            value={selected}
            onValueChange={(value) =>
              void navigate({ to: "/cafe/live", search: { siteId: value } })
            }
          >
            <SelectTrigger className="w-56">
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
        }
      />

      {/* Anomalies first, and per GROUP. One failing group on a three-group
          machine is the most common real fault, and a machine-level average
          hides it behind two groups that are fine. */}
      {anomalies.map((anomaly) => (
        <Alert key={`${anomaly.kind}-${anomaly.groupNumber}`} variant="destructive">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>Group {anomaly.groupNumber}</AlertTitle>
          <AlertDescription>{anomaly.message}</AlertDescription>
        </Alert>
      ))}

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Shots, last 5 minutes" value={shots.length} />
        <Metric
          label="In spec"
          value={shots.length ? `${Math.round((inSpec / shots.length) * 100)}%` : "—"}
          hint={shots.length ? `${inSpec} of ${shots.length}` : "No shots yet"}
        />
        <Metric label="Watching" value={live.data?.watchers ?? 0} hint="Screens on this bar" />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Recent shots</CardTitle>
        </CardHeader>
        <CardContent>
          {shots.length === 0 ? (
            <EmptyState
              icon={Coffee}
              title="Nothing in the last five minutes"
              description="Shots appear here as the bar pulls them."
              className="border-0"
            />
          ) : (
            <ul className="divide-y divide-border">
              {shots.slice(0, 25).map((shot) => (
                <li key={shot.externalId} className="flex items-center gap-3 py-2 text-sm">
                  <Badge variant="secondary" className="shrink-0">
                    G{shot.groupNumber}
                  </Badge>
                  <span className="w-16 shrink-0 font-mono text-muted-foreground text-xs tabular-nums">
                    {relativeSeconds(shot.pulledAt)}
                  </span>
                  <div className="flex flex-1 gap-4 font-mono text-xs tabular-nums">
                    <span>{shot.doseG?.toFixed(1) ?? "—"} g in</span>
                    <span>{shot.yieldG?.toFixed(1) ?? "—"} g out</span>
                    <span>{shot.durationS?.toFixed(1) ?? "—"} s</span>
                    <span className="text-muted-foreground">1:{shot.ratio?.toFixed(2) ?? "—"}</span>
                  </div>
                  <StatusBadge status={shot.verdict} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** "12s ago", counted from the shot's own timestamp. */
function relativeSeconds(pulledAt: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - pulledAt) / 1000));
  return seconds < 60 ? `${seconds}s` : formatElapsed(seconds);
}
