import { OpenAPIHono } from "@hono/zod-openapi";
import {
  blendComponents,
  blends,
  greenLots,
  lotConsumption,
  producers,
  roastBatches,
  roastedLots,
} from "@roastery/db/schema";
import {
  adjustRoastedLotInput,
  blendSchema,
  createBlendInput,
  getBlendInput,
  getRoastedLotInput,
  listBlendsInput,
  listBlendsOutput,
  listRoastedLotsInput,
  listRoastedLotsOutput,
  roastedLotSchema,
  traceRoastedLotInput,
  traceRoastedLotOutput,
  validateBlendInput,
  validateBlendOutput,
} from "@roastery/schemas";
import { and, asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { isUniqueViolation } from "../lib/db";
import { BadRequest, Conflict, NotFound } from "../lib/errors";
import { kg } from "../lib/inventory";
import { applyRoastedTransaction, validateBlendAvailability } from "../lib/roasted";
import { type RpcAppEnv, registerRpc } from "../lib/rpc";

export const inventoryRoast = new OpenAPIHono<RpcAppEnv>();

function toDto(r: typeof roastedLots.$inferSelect) {
  const bb = r.bestBeforeAt?.getTime();
  return {
    id: r.id,
    name: r.name,
    lotCode: r.lotCode,
    lotKind: r.lotKind,
    blendId: r.blendId ?? null,
    roastBatchId: r.roastBatchId ?? null,
    roastLevel: r.roastLevel ?? null,
    initialWeightKg: r.initialWeightKg,
    currentWeightKg: r.currentWeightKg,
    reservedWeightKg: r.reservedWeightKg,
    availableWeightKg: kg.sub(r.currentWeightKg, r.reservedWeightKg),
    // Negative once past the date, which is what the "sell this first" screen
    // sorts on.
    daysUntilBestBefore: bb ? Math.ceil((bb - Date.now()) / 86_400_000) : null,
    locationId: r.locationId ?? null,
    roastedAt: r.roastedAt.toISOString(),
    bestBeforeAt: r.bestBeforeAt?.toISOString() ?? null,
    status: r.status,
  };
}

registerRpc(
  inventoryRoast,
  {
    namespace: "inventory.roast",
    operation: "listRoastedLots",
    summary: "List roasted inventory",
    description:
      "Loose, packaged and blended stock. Roasted coffee has a usable window measured " +
      "in weeks, so this is usually read freshness-first rather than by arrival order.",
    input: listRoastedLotsInput,
    output: listRoastedLotsOutput,
    permission: "inventory.roast.read",
    module: "inventory",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    const f = input.filter;
    if (f?.lotKind) clauses.push(eq(roastedLots.lotKind, f.lotKind));
    if (f?.status) clauses.push(eq(roastedLots.status, f.status));
    if (f?.blendId) clauses.push(eq(roastedLots.blendId, f.blendId));
    if (f?.expiringWithinDays !== undefined) {
      const cutoff = new Date(Date.now() + f.expiringWithinDays * 86_400_000);
      clauses.push(sql`${roastedLots.bestBeforeAt} is not null
        and ${roastedLots.bestBeforeAt} <= ${cutoff}`);
    }
    const { items, page } = await ctx.db.find(roastedLots, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return { items: items.map(toDto), page };
  },
);

registerRpc(
  inventoryRoast,
  {
    namespace: "inventory.roast",
    operation: "getRoastedLot",
    summary: "Get one roasted lot",
    input: getRoastedLotInput,
    output: roastedLotSchema,
    permission: "inventory.roast.read",
    module: "inventory",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const row = await ctx.db.findOne(roastedLots, eq(roastedLots.id, input.id));
    if (!row) throw new NotFound("Roasted lot not found");
    return toDto(row);
  },
);

registerRpc(
  inventoryRoast,
  {
    namespace: "inventory.roast",
    operation: "adjustRoastedLotQuantity",
    summary: "Adjust roasted stock",
    description: "Append-only, like the green ledger: the balance is never written directly.",
    input: adjustRoastedLotInput,
    output: roastedLotSchema,
    permission: "inventory.roast.write",
    module: "inventory",
  },
  async (input, ctx) => {
    await applyRoastedTransaction(ctx.db, {
      roastedLotId: input.id,
      eventType: input.reason,
      deltaKg: input.deltaKg,
      comment: input.comment ?? null,
      allowNegative: input.reason === "recount",
    });
    const row = await ctx.db.findOne(roastedLots, eq(roastedLots.id, input.id));
    if (!row) throw new NotFound("Roasted lot not found");
    return toDto(row);
  },
);

/* ----------------------------------------------------------------- blends */

async function blendWithComponents(ctx: { db: RpcAppEnv["Variables"]["orgDb"] }, blendId: string) {
  const blend = await ctx.db.findOne(blends, eq(blends.id, blendId));
  if (!blend) throw new NotFound("Blend not found");
  const components = await ctx.db.query(async (t, scope) =>
    t
      .select()
      .from(blendComponents)
      .where(and(scope(blendComponents), eq(blendComponents.blendId, blendId)))
      .orderBy(asc(blendComponents.position)),
  );
  return {
    id: blend.id,
    name: blend.name,
    code: blend.code,
    blendType: blend.blendType,
    targetWeightLossPct: blend.targetWeightLossPct ?? null,
    roastLevel: (blend.roastLevel as "light" | "medium" | "dark" | null) ?? null,
    isDecaf: blend.isDecaf,
    isActive: blend.isActive,
    components: components.map((c) => ({
      id: c.id,
      greenLotId: c.greenLotId ?? null,
      roastedLotId: c.roastedLotId ?? null,
      targetRatioPct: c.targetRatioPct,
      position: c.position,
    })),
    createdAt: blend.createdAt.toISOString(),
  };
}

registerRpc(
  inventoryRoast,
  {
    namespace: "inventory.blend",
    operation: "listBlends",
    summary: "List blend recipes",
    input: listBlendsInput,
    output: listBlendsOutput,
    permission: "inventory.blend.read",
    module: "inventory",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.blendType) clauses.push(eq(blends.blendType, input.filter.blendType));
    if (input.filter?.isActive !== undefined) {
      clauses.push(eq(blends.isActive, input.filter.isActive));
    }
    const { items, page } = await ctx.db.find(blends, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });
    return {
      items: items.map((b) => ({
        id: b.id,
        name: b.name,
        code: b.code,
        blendType: b.blendType,
        targetWeightLossPct: b.targetWeightLossPct ?? null,
        roastLevel: (b.roastLevel as "light" | "medium" | "dark" | null) ?? null,
        isDecaf: b.isDecaf,
        isActive: b.isActive,
        createdAt: b.createdAt.toISOString(),
      })),
      page,
    };
  },
);

registerRpc(
  inventoryRoast,
  {
    namespace: "inventory.blend",
    operation: "getBlend",
    summary: "Get a blend and its components",
    input: getBlendInput,
    output: blendSchema,
    permission: "inventory.blend.read",
    module: "inventory",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => blendWithComponents(ctx, input.id),
);

registerRpc(
  inventoryRoast,
  {
    namespace: "inventory.blend",
    operation: "createBlend",
    summary: "Define a blend recipe",
    description:
      "The recipe, not a production run. Target ratios are never mutated to match what " +
      "was actually produced — that drift is recorded separately, which is what makes " +
      "'we shipped 3% off spec' a question the data can answer.",
    input: createBlendInput,
    output: blendSchema,
    permission: "inventory.blend.write",
    module: "inventory",
  },
  async (input, ctx) => {
    const total = input.components.reduce((acc, c) => kg.add(acc, c.targetRatioPct), "0");
    if (kg.cmp(total, "100") !== 0) {
      throw new BadRequest(`Component ratios total ${total}%, not 100%`);
    }
    // A pre-roast blend combines GREEN before the drum; a post-roast blend
    // combines already-roasted lots. Mixing the two in one recipe describes
    // something nobody can produce.
    for (const c of input.components) {
      const isGreen = Boolean(c.greenLotId);
      const isRoasted = Boolean(c.roastedLotId);
      if (isGreen === isRoasted) {
        throw new BadRequest("Each component must reference exactly one lot");
      }
      if (input.blendType === "pre_roast" && !isGreen) {
        throw new BadRequest("A pre-roast blend's components must be green lots");
      }
      if (input.blendType === "post_roast" && !isRoasted) {
        throw new BadRequest("A post-roast blend's components must be roasted lots");
      }
    }

    const id = await ctx.db.transaction(async (tx) => {
      let blend: typeof blends.$inferSelect | undefined;
      try {
        [blend] = await tx.insert(blends, {
          name: input.name,
          code: input.code,
          blendType: input.blendType,
          targetWeightLossPct: input.targetWeightLossPct ?? null,
          roastLevel: input.roastLevel ?? null,
          isDecaf: input.isDecaf ?? false,
        });
      } catch (err) {
        if (isUniqueViolation(err)) throw new Conflict(`Blend "${input.code}" already exists`);
        throw err;
      }
      if (!blend) throw new Error("Insert returned no row");

      await tx.insert(
        blendComponents,
        input.components.map((c, i) => ({
          blendId: blend.id,
          greenLotId: c.greenLotId ?? null,
          roastedLotId: c.roastedLotId ?? null,
          targetRatioPct: c.targetRatioPct,
          position: i,
        })),
      );
      return blend.id;
    });

    return blendWithComponents(ctx, id);
  },
);

registerRpc(
  inventoryRoast,
  {
    namespace: "inventory.blend",
    operation: "validateBlendAvailability",
    summary: "Can this blend be produced right now?",
    description:
      "Answers per component, because 'you are short' is not actionable but 'you are " +
      "12.4 kg short of the Ethiopian' is. Green is grossed up for expected roast loss: " +
      "sizing against the roasted target under-orders on every run.",
    input: validateBlendInput,
    output: validateBlendOutput,
    permission: "inventory.blend.read",
    module: "inventory",
  },
  async (input, ctx) => validateBlendAvailability(ctx.db, input.blendId, input.requestedKg),
);

/* ----------------------------------------------------------- traceability */

registerRpc(
  inventoryRoast,
  {
    namespace: "inventory.roast",
    operation: "getRoastedLotTraceability",
    summary: "Walk a roasted lot back to the farm",
    description:
      "Follows the lineage edges backwards: roasted lot to roast batch to green lot to " +
      "producer. This is what a recall investigation and a traceability certificate " +
      "both need, and why lineage is stored as edges rather than a parent pointer.",
    input: traceRoastedLotInput,
    output: traceRoastedLotOutput,
    permission: "traceability.read",
    module: "core",
    cacheable: { maxAgeSeconds: 60 },
  },
  async (input, ctx) => {
    const lot = await ctx.db.findOne(roastedLots, eq(roastedLots.id, input.id));
    if (!lot) throw new NotFound("Roasted lot not found");

    const chain: { kind: string; id: string; label: string; weightKg: string | null }[] = [
      { kind: "roasted_lot", id: lot.id, label: lot.name, weightKg: lot.initialWeightKg },
    ];

    // Walk upstream one level at a time. Bounded because coffee lineage is
    // shallow by nature — farm to cup is under a dozen hops — and an unbounded
    // walk on a cyclic edge would hang the request.
    let frontier: { kind: string; id: string }[] = [{ kind: "roasted_lot", id: lot.id }];
    for (let depth = 0; depth < 12 && frontier.length; depth++) {
      const edges = await ctx.db.query(async (t, scope) =>
        t
          .select({
            sourceKind: lotConsumption.sourceKind,
            sourceId: lotConsumption.sourceId,
            weightKg: lotConsumption.weightKg,
          })
          .from(lotConsumption)
          .where(
            and(
              scope(lotConsumption),
              inArray(
                lotConsumption.targetId,
                frontier.map((f) => f.id),
              ),
            ),
          ),
      );
      if (!edges.length) break;

      const next: { kind: string; id: string }[] = [];
      for (const edge of edges) {
        let label = edge.sourceId;
        if (edge.sourceKind === "green_lot") {
          const g = await ctx.db.findOne(greenLots, eq(greenLots.id, edge.sourceId));
          label = g ? `${g.name} (${g.lotCode})` : edge.sourceId;
        } else if (edge.sourceKind === "roast_batch") {
          const b = await ctx.db.findOne(roastBatches, eq(roastBatches.id, edge.sourceId));
          label = b ? b.batchNumber : edge.sourceId;
        } else if (edge.sourceKind === "producer") {
          // The farm is the point of the whole walk; showing its id here would
          // make the one node a person actually cares about unreadable.
          const pr = await ctx.db.findOne(producers, eq(producers.id, edge.sourceId));
          label = pr ? `${pr.name}${pr.country ? ` (${pr.country})` : ""}` : edge.sourceId;
        }
        chain.push({
          kind: edge.sourceKind,
          id: edge.sourceId,
          label,
          weightKg: edge.weightKg,
        });
        next.push({ kind: edge.sourceKind, id: edge.sourceId });
      }
      frontier = next;
    }

    return { roastedLotId: lot.id, chain };
  },
);
