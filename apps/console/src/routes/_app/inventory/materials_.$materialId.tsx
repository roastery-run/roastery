import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  rpc,
  StatusBadge,
} from "@roastery/ui";
import { formatDate, formatMoney, formatNumber, humanize } from "@roastery/units";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { DetailLayout } from "@/components/detail-layout";
import { MaterialActions } from "@/components/inventory/material-actions";
import { describeApiFailure, retryLabelFor } from "@/lib/api-failure";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_app/inventory/materials_/$materialId")({
  component: MaterialDetail,
});

type Material = {
  id: string;
  sku: string;
  name: string;
  kind: string;
  onHandQty: string;
  reorderPoint: string | null;
  reorderQty: string | null;
  leadTimeDays: number | null;
  needsReorder: boolean;
  unitCost: string | null;
  currency: string | null;
  isActive: boolean;
  createdAt: string;
};

function MaterialDetail() {
  const { materialId } = Route.useParams();
  const { can } = useWorkspace();

  const material = useQuery({
    queryKey: ["inventory.material", "get", materialId],
    queryFn: () => rpc<Material>("inventory.material.getMaterial", { id: materialId }),
  });

  if (material.isError) {
    const failure = describeApiFailure(material.error, "this material");
    return (
      <ErrorState
        title={failure.title}
        description={failure.description}
        correlationId={failure.correlationId}
        onRetry={() => void material.refetch()}
        retryLabel={retryLabelFor(failure.action)}
      />
    );
  }

  const data = material.data;

  return (
    <DetailLayout
      isLoading={material.isLoading}
      title={data?.name ?? ""}
      subtitle={data ? `Added ${formatDate(data.createdAt)}` : undefined}
      status={
        data ? (
          <span className="flex items-center gap-2">
            <StatusBadge status={data.isActive ? "active" : "disabled"} />
            {/* Below its reorder point is the one thing worth interrupting for
                on this screen, and it carries a glyph because this page gets
                printed before somebody phones a supplier. */}
            {data.needsReorder ? (
              <Badge variant="warning">
                <span aria-hidden="true">▲</span> Below reorder point
              </Badge>
            ) : null}
          </span>
        ) : null
      }
      actions={
        data ? <MaterialActions material={data} canWrite={can("inventory.material.write")} /> : null
      }
      facts={[
        { label: "SKU", mono: true, value: data?.sku ?? "—" },
        { label: "Kind", value: data ? humanize(data.kind) : "—" },
        {
          label: "On hand",
          mono: true,
          primary: true,
          value: data ? formatNumber(data.onHandQty, { digits: 0 }) : "—",
        },
        {
          label: "Reorder point",
          mono: true,
          primary: true,
          value: data?.reorderPoint ? formatNumber(data.reorderPoint, { digits: 0 }) : "—",
        },
        {
          label: "Reorder quantity",
          mono: true,
          value: data?.reorderQty ? formatNumber(data.reorderQty, { digits: 0 }) : "—",
        },
        {
          label: "Lead time",
          mono: true,
          value:
            data?.leadTimeDays !== null && data?.leadTimeDays !== undefined
              ? `${data.leadTimeDays} days`
              : "—",
        },
        {
          label: "Unit cost",
          mono: true,
          value: data?.unitCost ? formatMoney(data.unitCost, data.currency ?? "USD") : "—",
        },
      ]}
    >
      {data?.needsReorder ? (
        <Card className="border border-warning/30 bg-warning/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Time to reorder</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p className="max-w-prose text-muted-foreground">
              {/* Lead time is the actionable half: being short of something
                  that takes six weeks is a different problem from being short
                  of something local. */}
              On hand has fallen to {formatNumber(data.onHandQty, { digits: 0 })}, at or below the
              reorder point of {formatNumber(data.reorderPoint ?? "0", { digits: 0 })}.
              {data.leadTimeDays !== null
                ? ` This one takes ${data.leadTimeDays} days to arrive, so an order placed today lands ${formatDate(
                    new Date(Date.now() + data.leadTimeDays * 86_400_000).toISOString(),
                  )}.`
                : ""}
            </p>
          </CardContent>
        </Card>
      ) : null}
    </DetailLayout>
  );
}
