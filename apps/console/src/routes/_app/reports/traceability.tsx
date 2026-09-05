import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Field,
  FieldLabel,
  Input,
  Label,
  PageHeader,
  rpc,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@roastery/ui";
import { formatDate, humanize } from "@roastery/units";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { GitBranch, Search } from "lucide-react";
import * as React from "react";

/**
 * Tracing a lot in either direction.
 *
 * Backward is "what went into this" — the certificate direction. Forward is
 * "where did this end up", which is the one that matters during a recall:
 * given a contaminated green lot, find every customer who received it.
 */
export const Route = createFileRoute("/_app/reports/traceability")({ component: Traceability });

const KINDS = ["green_lot", "roast_batch", "roasted_lot", "producer", "order_line"] as const;

type TraceNode = {
  kind: string;
  id: string;
  label: string;
  detail: Record<string, string | null>;
};
type TraceEdge = {
  depth: number;
  sourceKind: string;
  sourceId: string;
  targetKind: string;
  targetId: string;
  weightKg: string;
};
type TraceResult = {
  direction: string;
  nodes: TraceNode[];
  edges: TraceEdge[];
  truncated: boolean;
};

function Traceability() {
  const [kind, setKind] = React.useState<string>("roasted_lot");
  const [id, setId] = React.useState("");
  const [query, setQuery] = React.useState<{ kind: string; id: string } | null>(null);
  const [direction, setDirection] = React.useState<"backward" | "forward">("backward");

  const trace = useQuery({
    queryKey: ["traceability", direction, query],
    queryFn: () =>
      rpc<TraceResult>(
        direction === "backward" ? "traceability.traceBackward" : "traceability.traceForward",
        query,
      ),
    enabled: Boolean(query),
  });

  const nodesByDepth = React.useMemo(() => {
    if (!trace.data) return [];
    const byId = new Map(trace.data.nodes.map((n) => [n.id, n]));
    const depths = new Map<number, TraceNode[]>();
    for (const edge of trace.data.edges) {
      // The far end of each edge is what the walk reached at that depth.
      const reachedId = direction === "backward" ? edge.sourceId : edge.targetId;
      const node = byId.get(reachedId);
      if (!node) continue;
      const list = depths.get(edge.depth) ?? [];
      if (!list.some((n) => n.id === node.id)) list.push(node);
      depths.set(edge.depth, list);
    }
    return [...depths.entries()].sort(([a], [b]) => a - b);
  }, [trace.data, direction]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Traceability"
        description="Walk the lineage graph in either direction, in one query."
      />

      <Card>
        <CardContent className="pt-6">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (id.trim()) setQuery({ kind, id: id.trim() });
            }}
          >
            <Field>
              <FieldLabel htmlFor="kind">Kind</FieldLabel>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="kind" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {humanize(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <div className="min-w-72 flex-1 space-y-1.5">
              <Label htmlFor="id">Identifier</Label>
              <Input
                id="id"
                value={id}
                onChange={(event) => setId(event.target.value)}
                placeholder="UUID of the lot, batch or producer"
                required
              />
            </div>

            <Field>
              <FieldLabel htmlFor="direction">Direction</FieldLabel>
              <Select
                value={direction}
                onValueChange={(value) => setDirection(value as "backward" | "forward")}
              >
                <SelectTrigger id="direction" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="backward">Backward — what went in</SelectItem>
                  <SelectItem value="forward">Forward — where it went</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Button type="submit" disabled={!id.trim()}>
              <Search className="size-3.5" aria-hidden="true" />
              Trace
            </Button>
          </form>
        </CardContent>
      </Card>

      {trace.isError ? (
        <EmptyState
          icon={GitBranch}
          title="Nothing found"
          description="Check the identifier. A lot with no recorded lineage traces to nothing."
        />
      ) : null}

      {trace.data ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              {trace.data.edges.length} edges, {trace.data.nodes.length} nodes
              {/* Truncation is SHOWN, never hidden: a partial chain that looks
                  complete is worse than one that admits it is not. */}
              {trace.data.truncated ? <Badge variant="warning">Truncated</Badge> : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {nodesByDepth.map(([depth, nodes]) => (
              <div key={depth}>
                <div className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">
                  {direction === "backward" ? `${depth} step back` : `${depth} step forward`}
                  {depth === 1 ? "" : "s"}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {nodes.map((node) => (
                    <div
                      key={node.id}
                      className="rounded-2xl bg-card ring-1 ring-foreground/10 p-3"
                    >
                      <Badge variant="secondary" className="mb-1.5">
                        {humanize(node.kind)}
                      </Badge>
                      <div className="truncate font-medium text-sm">{node.label}</div>
                      <dl className="mt-1 space-y-0.5 text-xs">
                        {Object.entries(node.detail)
                          .filter(([, value]) => value)
                          .map(([key, value]) => (
                            <div key={key} className="flex gap-1.5">
                              <dt className="text-muted-foreground">{humanize(key)}</dt>
                              <dd className="truncate">
                                {key.endsWith("At") ? formatDate(value) : value}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
