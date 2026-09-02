/**
 * Walking the lineage graph.
 *
 * Lineage lives in `lot_consumption` as a polymorphic edge table:
 * `(sourceKind, sourceId) → (targetKind, targetId)` with a weight. A self-FK
 * on the lot could not express a merge, and a closure table would pay write
 * amplification on every roast to speed up a query run a few times a day.
 *
 * One recursive CTE per direction, not one query per hop. The per-hop loop it
 * replaces issued a round trip for every level, so a farm-to-cup trace was
 * eight sequential queries — on a Worker talking to Postgres over Hyperdrive
 * that is eight times the latency for a graph small enough to walk in one.
 */
import {
  blends,
  greenLots,
  lotConsumption,
  producers,
  roastBatches,
  roastedLots,
  salesOrderLines,
} from "@roastery/db/schema";
import { inArray, sql } from "drizzle-orm";
import type { OrgDb } from "../db/org-db";

export type TraceNodeKind =
  | "producer"
  | "green_lot"
  | "roast_batch"
  | "roasted_lot"
  | "blend_lot"
  | "product_batch"
  | "order_line";

export type TraceEdge = {
  depth: number;
  sourceKind: TraceNodeKind;
  sourceId: string;
  targetKind: TraceNodeKind;
  targetId: string;
  weightKg: string;
  ratioPct: string | null;
  occurredAt: string;
};

export type TraceNode = {
  kind: TraceNodeKind;
  id: string;
  label: string;
  /** Only what a reader needs to recognise the node; never the whole row. */
  detail: Record<string, string | null>;
};

export type TraceResult = {
  root: { kind: TraceNodeKind; id: string };
  direction: "backward" | "forward";
  nodes: TraceNode[];
  edges: TraceEdge[];
  truncated: boolean;
};

/**
 * Coffee lineage is shallow by nature — farm to cup is under a dozen hops — so
 * this bound is a guard against a cycle rather than a real limit. A cycle
 * should be impossible, but an unbounded recursive CTE on one would hang the
 * request rather than fail it, which is far worse.
 */
const MAX_DEPTH = 12;
const MAX_EDGES = 2000;

export async function trace(
  db: OrgDb,
  root: { kind: TraceNodeKind; id: string },
  direction: "backward" | "forward",
): Promise<TraceResult> {
  // Backward asks "what went into this", so it follows target → source.
  // Forward asks "where did this end up", so it follows source → target.
  const fromKind = direction === "backward" ? "target_kind" : "source_kind";
  const fromId = direction === "backward" ? "target_id" : "source_id";
  const toId = direction === "backward" ? "source_id" : "target_id";

  const edges = await db.query<TraceEdge[]>(async (t, scope) => {
    // The scope predicate renders columns fully qualified as
    // "lot_consumption"."org_id", so the table is referenced UNALIASED
    // throughout. Aliasing it as `e` and letting Drizzle emit the qualified
    // name is exactly how this query first failed with "invalid reference to
    // FROM-clause entry".
    const scoped = scope(lotConsumption);
    const col = (name: string) => sql.raw(`lot_consumption.${name}`);

    const rows = await t.execute(sql`
      with recursive walk as (
        select
          lot_consumption.source_kind, lot_consumption.source_id,
          lot_consumption.target_kind, lot_consumption.target_id,
          lot_consumption.weight_kg, lot_consumption.ratio_pct,
          lot_consumption.occurred_at,
          1 as depth,
          array[${col(fromId)}] as visited
        from lot_consumption
        where ${scoped}
          and ${col(fromKind)} = ${root.kind}::trace_node_kind
          and ${col(fromId)} = ${root.id}::uuid

        union all

        select
          lot_consumption.source_kind, lot_consumption.source_id,
          lot_consumption.target_kind, lot_consumption.target_id,
          lot_consumption.weight_kg, lot_consumption.ratio_pct,
          lot_consumption.occurred_at,
          w.depth + 1,
          w.visited || ${col(toId)}
        from lot_consumption
        join walk w on ${col(fromId)} = w.${sql.raw(toId)}
        where ${scoped}
          and w.depth < ${MAX_DEPTH}
          -- The cycle guard. Without it a bad edge turns a trace into a hang,
          -- which is far worse than failing.
          and not (${col(toId)} = any(w.visited))
      )
      select distinct
        depth, source_kind, source_id, target_kind, target_id,
        weight_kg, ratio_pct, occurred_at
      from walk
      order by depth
      limit ${MAX_EDGES + 1}
    `);

    return (rows as unknown as Record<string, unknown>[]).map((r) => ({
      depth: Number(r.depth),
      sourceKind: r.source_kind as TraceNodeKind,
      sourceId: String(r.source_id),
      targetKind: r.target_kind as TraceNodeKind,
      targetId: String(r.target_id),
      weightKg: String(r.weight_kg),
      ratioPct: r.ratio_pct === null ? null : String(r.ratio_pct),
      occurredAt: new Date(r.occurred_at as string).toISOString(),
    }));
  });

  const truncated = edges.length > MAX_EDGES;
  const kept = truncated ? edges.slice(0, MAX_EDGES) : edges;

  const wanted = new Map<TraceNodeKind, Set<string>>();
  const want = (kind: TraceNodeKind, id: string) => {
    const set = wanted.get(kind) ?? new Set<string>();
    set.add(id);
    wanted.set(kind, set);
  };
  want(root.kind, root.id);
  for (const e of kept) {
    want(e.sourceKind, e.sourceId);
    want(e.targetKind, e.targetId);
  }

  return {
    root,
    direction,
    nodes: await labelNodes(db, wanted),
    edges: kept,
    truncated,
  };
}

/**
 * Turns ids into something a person can read.
 *
 * One query per node KIND rather than one per node: the edge table is
 * polymorphic and carries no foreign keys, so labels cannot come from a join,
 * and fetching them individually would undo the point of walking the graph in
 * one query.
 */
async function labelNodes(
  db: OrgDb,
  wanted: Map<TraceNodeKind, Set<string>>,
): Promise<TraceNode[]> {
  const nodes: TraceNode[] = [];

  for (const [kind, ids] of wanted) {
    const list = [...ids];
    if (!list.length) continue;

    switch (kind) {
      case "producer": {
        const rows = await db.query(async (t, scope) =>
          t
            .select()
            .from(producers)
            .where(sql`${scope(producers)} and ${inArray(producers.id, list)}`),
        );
        for (const r of rows) {
          nodes.push({
            kind,
            id: r.id,
            label: r.name,
            detail: {
              country: r.country ?? null,
              region: r.region ?? null,
              // What a drinker scanning a bag actually wants to see.
              altitude:
                r.altitudeMinM === null && r.altitudeMaxM === null
                  ? null
                  : `${r.altitudeMinM ?? "?"}-${r.altitudeMaxM ?? "?"} m`,
            },
          });
        }
        break;
      }
      case "green_lot": {
        const rows = await db.query(async (t, scope) =>
          t
            .select()
            .from(greenLots)
            .where(sql`${scope(greenLots)} and ${inArray(greenLots.id, list)}`),
        );
        for (const r of rows) {
          nodes.push({
            kind,
            id: r.id,
            label: `${r.name} (${r.lotCode})`,
            detail: {
              lotCode: r.lotCode,
              process: r.processMethod ?? null,
              harvestYear: r.harvestYear === null ? null : String(r.harvestYear),
              status: r.status,
            },
          });
        }
        break;
      }
      case "roast_batch": {
        const rows = await db.query(async (t, scope) =>
          t
            .select()
            .from(roastBatches)
            .where(sql`${scope(roastBatches)} and ${inArray(roastBatches.id, list)}`),
        );
        for (const r of rows) {
          nodes.push({
            kind,
            id: r.id,
            label: r.batchNumber,
            detail: {
              roastedAt: r.startedAt?.toISOString() ?? null,
              dropWeightKg: r.dropWeightKg ?? null,
              weightLossPct: r.weightLossPct ?? null,
            },
          });
        }
        break;
      }
      case "roasted_lot":
      case "blend_lot": {
        const rows = await db.query(async (t, scope) =>
          t
            .select()
            .from(roastedLots)
            .where(sql`${scope(roastedLots)} and ${inArray(roastedLots.id, list)}`),
        );
        for (const r of rows) {
          nodes.push({
            kind,
            id: r.id,
            label: `${r.name} (${r.lotCode})`,
            detail: {
              roastLevel: r.roastLevel ?? null,
              roastedAt: r.roastedAt?.toISOString() ?? null,
              bestBeforeAt: r.bestBeforeAt?.toISOString() ?? null,
            },
          });
        }
        break;
      }
      case "order_line": {
        const rows = await db.query(async (t, scope) =>
          t
            .select()
            .from(salesOrderLines)
            .where(sql`${scope(salesOrderLines)} and ${inArray(salesOrderLines.id, list)}`),
        );
        for (const r of rows) {
          nodes.push({
            kind,
            id: r.id,
            label: r.description,
            detail: { weightKg: r.weightKg, quantity: r.quantity },
          });
        }
        break;
      }
      default: {
        // A kind with no label source yet (product_batch, until packaging
        // ships). Shown as an id rather than dropped, so the chain stays
        // connected and the gap is visible instead of silent.
        for (const id of list) {
          nodes.push({ kind, id, label: id, detail: {} });
        }
      }
    }
  }

  return nodes;
}

/** A blend's recipe, for the certificate. Composition, not lineage. */
export async function blendComposition(db: OrgDb, blendId: string) {
  return db.query(async (t, scope) =>
    t
      .select()
      .from(blends)
      .where(sql`${scope(blends)} and ${inArray(blends.id, [blendId])}`),
  );
}
