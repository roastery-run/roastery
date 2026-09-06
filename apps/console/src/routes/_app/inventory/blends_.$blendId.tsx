import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  ErrorState,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  rpc,
  Skeleton,
  StatusBadge,
} from "@roastery/ui";
import { formatDate, formatNumber, formatPercent, formatWeight, humanize } from "@roastery/units";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import * as React from "react";
import { DetailLayout } from "@/components/detail-layout";
import { describeApiFailure, retryLabelFor } from "@/lib/api-failure";
import { useDebounced } from "@/lib/use-debounced";

/**
 * A blend, and whether you can actually make it today.
 *
 * Deliberately not a static recipe card. `getBlend` returns component IDs
 * without names, and `validateBlendAvailability` returns names, required
 * weight, available weight and the per-component shortfall — so the useful
 * page and the only page that can name its own components are the same page.
 *
 * The green requirement is grossed up for roast loss by the API. That is the
 * coffee-specific thing: sizing against the roasted target under-orders on
 * every single run, and a recipe screen that showed the ratio alone would let
 * somebody do exactly that.
 */
export const Route = createFileRoute("/_app/inventory/blends_/$blendId")({
  component: BlendDetail,
});

type Blend = {
  id: string;
  name: string;
  code: string;
  blendType: string;
  targetWeightLossPct: string | null;
  roastLevel: string | null;
  isDecaf: boolean;
  isActive: boolean;
  components: { id: string; targetRatioPct: string; position: number }[];
  createdAt: string;
};

type Availability = {
  requestedKg: string;
  greenRequiredKg: string;
  feasible: boolean;
  components: {
    componentId: string;
    lotName: string;
    targetRatioPct: string;
    requiredKg: string;
    availableKg: string;
    shortfallKg: string;
  }[];
};

function BlendDetail() {
  const { blendId } = Route.useParams();
  // A round batch somebody would actually roast, not 1 kg. The figure is only a
  // question — nothing here writes anything.
  const [requested, setRequested] = React.useState("100");

  const blend = useQuery({
    queryKey: ["inventory.blend.getBlend", blendId],
    queryFn: () => rpc<Blend>("inventory.blend.getBlend", { id: blendId }),
  });

  // Settles before asking: the key was the raw input, so typing "100" asked
  // the API three times, twice about a weight nobody wanted.
  const requestedQuery = useDebounced(requested, 300);
  const parsed = Number.parseFloat(requestedQuery);
  const availability = useQuery({
    queryKey: ["inventory.blend.validateBlendAvailability", blendId, requestedQuery],
    queryFn: () =>
      rpc<Availability>("inventory.blend.validateBlendAvailability", {
        blendId,
        requestedKg: requestedQuery,
      }),
    enabled: Number.isFinite(parsed) && parsed > 0,
  });

  if (blend.isError) {
    const failure = describeApiFailure(blend.error, "this blend");
    return (
      <ErrorState
        title={failure.title}
        description={failure.description}
        correlationId={failure.correlationId}
        onRetry={() => void blend.refetch()}
        retryLabel={retryLabelFor(failure.action)}
      />
    );
  }

  const data = blend.data;
  const check = availability.data;

  return (
    <DetailLayout
      isLoading={blend.isLoading}
      title={data?.name ?? ""}
      subtitle={data ? `Defined ${formatDate(data.createdAt)}` : undefined}
      status={
        data ? (
          <span className="flex items-center gap-2">
            <StatusBadge status={data.isActive ? "active" : "disabled"} />
            {/* Decaf is a roast-ORDER fact here, not a dietary label: decaf
                runs last so the drum is not carrying it into the next batch. */}
            {data.isDecaf ? <Badge variant="secondary">Decaf — roasts last</Badge> : null}
          </span>
        ) : null
      }
      facts={[
        { label: "Code", mono: true, value: data?.code ?? "—" },
        { label: "Type", value: data ? humanize(data.blendType) : "—" },
        { label: "Roast level", value: data?.roastLevel ? humanize(data.roastLevel) : "—" },
        {
          label: "Target loss",
          mono: true,
          value: data?.targetWeightLossPct ? formatPercent(data.targetWeightLossPct, 2) : "—",
        },
        {
          label: "Components",
          mono: true,
          value: data ? formatNumber(data.components.length) : "—",
        },
      ]}
    >
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Can this be produced right now?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr] sm:items-start">
            <Field>
              <FieldLabel htmlFor="requested">Roasted weight wanted</FieldLabel>
              <Input
                id="requested"
                value={requested}
                onChange={(event) => setRequested(event.target.value)}
                inputMode="decimal"
                className="font-mono"
              />
              <FieldDescription className="text-xs">
                In kilograms of finished coffee.
              </FieldDescription>
            </Field>

            {check ? (
              <div className="space-y-1 sm:pt-6">
                <p className="text-sm">
                  Needs{" "}
                  <span className="font-mono font-medium tabular-nums">
                    {formatWeight(check.greenRequiredKg, { unit: "kg" })}
                  </span>{" "}
                  of green.
                </p>
                <p className="text-muted-foreground text-xs">
                  {/* The gross-up is the whole reason this figure is not just
                      the requested weight, so it says so. */}
                  Grossed up from {formatWeight(check.requestedKg, { unit: "kg" })} roasted, for the
                  loss this blend expects.
                </p>
              </div>
            ) : null}
          </div>

          {availability.isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : availability.isError ? (
            <ErrorState
              title={describeApiFailure(availability.error, "this availability check").title}
              description={
                describeApiFailure(availability.error, "this availability check").description
              }
              onRetry={() => void availability.refetch()}
              retryLabel={retryLabelFor(
                describeApiFailure(availability.error, "this availability check").action,
              )}
            />
          ) : check ? (
            <>
              {check.feasible ? (
                <Alert>
                  <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
                  <AlertTitle>Every component is in stock</AlertTitle>
                  <AlertDescription>
                    This blend can be produced at {formatWeight(check.requestedKg, { unit: "kg" })}{" "}
                    today.
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert variant="destructive">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  <AlertTitle>
                    Short on {check.components.filter(isShort).length} of {check.components.length}{" "}
                    components
                  </AlertTitle>
                  <AlertDescription>
                    {/* "You are short" is not actionable; "you are 12.4 kg short
                        of the Ethiopian" is. */}
                    {check.components
                      .filter(isShort)
                      .map(
                        (component) =>
                          `${component.lotName}: ${formatWeight(component.shortfallKg, { unit: "kg" })} short`,
                      )
                      .join("; ")}
                  </AlertDescription>
                </Alert>
              )}

              {/* Outside the list: a `dl` takes `dt`/`dd` pairs or `div`
                  groups of them, and a row of bare spans is neither. */}
              <div
                aria-hidden="true"
                className="flex items-center gap-3 pb-2 text-muted-foreground text-xs"
              >
                <span className="min-w-0 flex-1">Component</span>
                <span className="w-16 text-right">Ratio</span>
                <span className="w-28 text-right">Needs</span>
                <span className="w-28 text-right">Available</span>
              </div>
              <dl className="divide-y divide-border">
                {check.components.map((component) => {
                  const short = isShort(component);
                  return (
                    <div
                      key={component.componentId}
                      className="flex items-center gap-3 py-2 text-sm"
                    >
                      <dt className="min-w-0 flex-1 truncate" title={component.lotName}>
                        {short ? (
                          <>
                            <span aria-hidden="true" className="mr-1 text-micro text-warning">
                              ▲
                            </span>
                            {/* The glyph is decoration and the colour is not
                                readable aloud, so the fact itself is said. */}
                            <span className="sr-only">Short: </span>
                          </>
                        ) : null}
                        {component.lotName}
                      </dt>
                      <dd className="w-16 text-right font-mono text-xs tabular-nums">
                        {formatPercent(component.targetRatioPct, 1)}
                      </dd>
                      <dd className="w-28 text-right font-mono text-xs tabular-nums">
                        {formatWeight(component.requiredKg, { unit: "kg" })}
                      </dd>
                      <dd
                        className={cn(
                          "w-28 text-right font-mono text-xs tabular-nums",
                          short ? "text-warning" : "text-muted-foreground",
                        )}
                      >
                        {formatWeight(component.availableKg, { unit: "kg" })}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              Enter a roasted weight above zero to check what it would take.
            </p>
          )}
        </CardContent>
      </Card>
    </DetailLayout>
  );
}

const isShort = (component: { shortfallKg: string }) =>
  Number.parseFloat(component.shortfallKg) > 0;
