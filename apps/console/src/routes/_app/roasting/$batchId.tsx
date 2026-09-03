import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  rpc,
  StatusBadge,
} from "@roastery/ui";
import { TimeSeriesChart } from "@roastery/ui/charts";
import { formatDateTime, formatElapsed, formatPercent, formatWeight } from "@roastery/units";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Radio } from "lucide-react";
import * as React from "react";
import { DetailLayout } from "@/components/detail-layout";

export const Route = createFileRoute("/_app/roasting/$batchId")({ component: RoastBatchDetail });

type Batch = {
  id: string;
  batchNumber: string;
  status: string;
  chargeWeightKg: string | null;
  dropWeightKg: string | null;
  weightLossPct: string | null;
  dtrPct: string | null;
  dropTempC: string | null;
  totalTimeS: number | null;
  startedAt: string | null;
};

/**
 * What the API actually returns: one row per sample, with decimal STRINGS.
 *
 * This screen was written against the columnar `curvePreview` shape used in
 * lists, and read `samples.t.length` on a plain array — so the first completed
 * batch with a real curve crashed the whole screen with "Cannot read
 * properties of undefined". Nothing caught it because until staging was seeded
 * there had never been a completed batch to open.
 */
type Curve = {
  samples: {
    t: string;
    beanTempC: string | null;
    envTempC: string | null;
    rorCPerMin: string | null;
  }[];
  events: { kind: string; atSeconds: string; note: string | null }[];
};

function RoastBatchDetail() {
  const { batchId } = Route.useParams();

  const batch = useQuery({
    queryKey: ["production.roast.getRoastBatch", batchId],
    queryFn: () => rpc<Batch>("production.roast.getRoastBatch", { id: batchId }),
  });

  const curve = useQuery({
    queryKey: ["production.roast.getRoastCurve", batchId],
    queryFn: () => rpc<Curve>("production.roast.getRoastCurve", { id: batchId }),
    // Only once the roast is over: an in-progress batch's curve lives in the
    // Durable Object and is watched live, not polled from Postgres.
    enabled: batch.data?.status === "completed",
  });

  if (batch.isError) {
    return <ErrorState title="Could not load this batch" description={batch.error.message} />;
  }

  const data = batch.data;

  /**
   * Rows of strings in, one array per series out.
   *
   * Converted here rather than in the API: a JSON number is a float by the
   * time it reaches a client, so the wire keeps decimal strings, and the chart
   * stays ignorant of the transport. A missing reading becomes NaN rather than
   * zero, so the line breaks where the probe did instead of diving to the
   * bottom of the axis and inventing a crash that never happened.
   */
  const samples = React.useMemo(() => {
    const rows = curve.data?.samples;
    if (!rows?.length) return null;
    const num = (v: string | null) => (v === null ? Number.NaN : Number(v));
    return {
      t: rows.map((r) => Number(r.t)),
      bt: rows.map((r) => num(r.beanTempC)),
      et: rows.map((r) => num(r.envTempC)),
      ror: rows.map((r) => num(r.rorCPerMin)),
    };
  }, [curve.data]);

  return (
    <DetailLayout
      isLoading={batch.isLoading}
      title={data?.batchNumber ?? ""}
      subtitle={data?.startedAt ? `Started ${formatDateTime(data.startedAt)}` : undefined}
      status={data ? <StatusBadge status={data.status} /> : null}
      actions={
        // Only while it is running: the live screen watches a session that
        // exists, and offering it for a finished roast leads somewhere empty.
        data?.status === "in_progress" || data?.status === "cooling" ? (
          <Button size="sm" asChild>
            <Link to="/roast/$batchId" params={{ batchId }}>
              <Radio className="size-3.5" aria-hidden="true" />
              Watch live
            </Link>
          </Button>
        ) : null
      }
      facts={[
        { label: "Charge", value: formatWeight(data?.chargeWeightKg) },
        { label: "Drop", value: formatWeight(data?.dropWeightKg) },
        { label: "Weight loss", value: formatPercent(data?.weightLossPct, 2) },
        { label: "Development ratio", value: formatPercent(data?.dtrPct, 2) },
        { label: "Drop temperature", value: data?.dropTempC ? `${data.dropTempC} °C` : "—" },
        { label: "Total time", value: formatElapsed(data?.totalTimeS) },
      ]}
    >
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Curve</CardTitle>
        </CardHeader>
        <CardContent>
          {samples && samples.t.length > 0 ? (
            <TimeSeriesChart
              title={`Roast curve for ${data?.batchNumber ?? "this batch"}`}
              description="Bean and environment temperature with rate of rise."
              x={samples.t}
              // Elapsed since charge, in mm:ss. Roasts are compared by elapsed
              // time, never by wall clock — machine clocks drift.
              formatX={(seconds) => formatElapsed(seconds)}
              xLabel="Time since charge"
              series={[
                { label: "Bean", values: samples.bt, unit: "°C", colorIndex: 0 },
                { label: "Environment", values: samples.et, unit: "°C", colorIndex: 1 },
                // Its own axis: RoR runs −200 to +40 while bean runs 90 to 220.
                {
                  label: "Rate of rise",
                  values: samples.ror,
                  unit: "°C/min",
                  colorIndex: 2,
                  axis: "right",
                },
              ]}
            />
          ) : (
            <EmptyState
              title={
                data?.status === "completed"
                  ? "No curve was recorded for this batch."
                  : "The curve appears once the roast is complete."
              }
              className="border-0"
            />
          )}
        </CardContent>
      </Card>
    </DetailLayout>
  );
}
