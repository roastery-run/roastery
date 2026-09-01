import { OpenAPIHono } from "@hono/zod-openapi";
import { costComponents, greenLots, landedCosts, organizations } from "@roastery/db/schema";
import { getLandedCostInput, landedCostSchema, setCostComponentsInput } from "@roastery/schemas";
import { and, eq } from "drizzle-orm";
import { recomputeLandedCost } from "../lib/costing";
import { NotFound } from "../lib/errors";
import { type RpcAppEnv, registerRpc } from "../lib/rpc";

export const inventoryCosting = new OpenAPIHono<RpcAppEnv>();

registerRpc(
  inventoryCosting,
  {
    namespace: "inventory.green",
    operation: "setGreenLotCostComponents",
    summary: "Set what a lot cost to land",
    description:
      "Replaces the lot's cost components and recomputes the rollup in one transaction, " +
      "so a corrected freight invoice flows straight through to the per-kilogram figure " +
      "rather than leaving a stale total nobody trusts.",
    input: setCostComponentsInput,
    output: landedCostSchema,
    permission: "inventory.green.write",
    module: "inventory",
  },
  async (input, ctx) => {
    const lot = await ctx.db.findOne(greenLots, eq(greenLots.id, input.greenLotId));
    if (!lot) throw new NotFound("Lot not found");

    // unscoped-ok: organizations is TENANT_GLOBAL, and this reads exactly the
    // caller's own organization — the id orgScope already resolved and
    // verified membership for.
    const [org] = await ctx.db.query(async (t) =>
      t
        .select({ baseCurrency: organizations.baseCurrency })
        .from(organizations)
        .where(eq(organizations.id, ctx.orgId))
        .limit(1),
    );
    const baseCurrency = org?.baseCurrency ?? "USD";

    await ctx.db.transaction(async (tx) => {
      // Replace wholesale rather than merge: a component that was deleted
      // upstream must disappear from the rollup, and diffing by kind would
      // silently keep it.
      await tx.delete(costComponents, eq(costComponents.greenLotId, input.greenLotId));

      if (input.components.length) {
        await tx.insert(
          costComponents,
          input.components.map((c) => ({
            greenLotId: input.greenLotId,
            kind: c.kind,
            label: c.label ?? null,
            amount: c.amount,
            currency: c.currency,
            // Single-currency for now: a real FX rate belongs to the date the
            // cost was incurred, which arrives with contracts in Phase 5.
            // Recording the rate used, even when it is 1, means the rollup
            // never has to guess later what it assumed.
            fxRateUsed: c.currency === baseCurrency ? "1.00000000" : "1.00000000",
            amountBase: c.amount,
            perUnit: c.perUnit,
          })),
        );
      }
    });

    return recomputeLandedCost(ctx.db, input.greenLotId);
  },
);

registerRpc(
  inventoryCosting,
  {
    namespace: "inventory.green",
    operation: "getGreenLotLandedCost",
    summary: "A lot's landed cost, broken down",
    description:
      "Components roll up into price, freight, duty, carry and other — the buckets a " +
      "roaster actually reasons in when asking why a coffee is expensive.",
    input: getLandedCostInput,
    output: landedCostSchema,
    permission: "inventory.green.read",
    module: "inventory",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const [row] = await ctx.db.query(async (t, scope) =>
      t
        .select()
        .from(landedCosts)
        .where(and(scope(landedCosts), eq(landedCosts.greenLotId, input.greenLotId)))
        .limit(1),
    );

    // Never computed, or components changed through another path: derive it
    // now rather than returning a zero that looks like a real answer.
    if (!row) return recomputeLandedCost(ctx.db, input.greenLotId);

    return {
      greenLotId: row.greenLotId,
      basePriceBase: row.basePriceBase,
      freightBase: row.freightBase,
      dutyBase: row.dutyBase,
      carryBase: row.carryBase,
      otherBase: row.otherBase,
      totalBase: row.totalBase,
      perKgBase: row.perKgBase,
    };
  },
);
