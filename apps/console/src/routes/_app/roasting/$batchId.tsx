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

type Curve = {
  samples: { t: number[]; bt: (number | null)[]; et: (number | null)[]; ror: (number | null)[] };
  events: { kind: string; atSeconds: number }[];
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
  const samples = curve.data?.samples;

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
