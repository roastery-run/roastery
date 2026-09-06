import { OpenAPIHono } from "@hono/zod-openapi";
import { costComponents, greenLots, landedCosts, organizations } from "@roastery/db/schema";
import {
  getLandedCostInput,
  landedCostSchema,
  listCostComponentsInput,
  listCostComponentsOutput,
  setCostComponentsInput,
} from "@roastery/schemas";
import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../../lib/api/rpc";
import { recomputeLandedCost } from "../../lib/domain/costing";

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
      // Replace wholesale rather than merge, so a component the caller dropped
      // disappears from the rollup instead of lingering — but only the ones
      // this caller owns. A `contractLineId` means the row came from a contract
      // receipt: the price a coffee was bought at is a fact of the purchase,
      // and deleting it here would destroy both the figure and the link back to
      // the line it came from, which is what makes a landed cost traceable.
      await tx.delete(
        costComponents,
        and(
          eq(costComponents.greenLotId, input.greenLotId),
          isNull(costComponents.contractLineId),
        ) as SQL,
      );

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
    operation: "listGreenLotCostComponents",
    summary: "The lines behind a lot's landed cost",
    description:
      "The rollup answers what a lot cost; this answers why. Components that came from a " +
      "contract receipt carry the line they came from, so a screen can show them without " +
      "offering to edit what the contract owns.",
    input: listCostComponentsInput,
    output: listCostComponentsOutput,
    permission: "inventory.green.read",
    module: "inventory",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const rows = await ctx.db.query(async (t, scope) =>
      t
        .select()
        .from(costComponents)
        .where(and(scope(costComponents), eq(costComponents.greenLotId, input.greenLotId)))
        // Contract-derived first: they are the ones a reader cannot change, and
        // reading them before the editable rows is the order the screen argues
        // in — what the purchase cost, then what was added to it.
        .orderBy(asc(costComponents.contractLineId), asc(costComponents.createdAt)),
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        label: r.label ?? null,
        amount: r.amount,
        currency: r.currency,
        perUnit: r.perUnit,
        amountBase: r.amountBase,
        contractLineId: r.contractLineId ?? null,
        incurredAt: r.incurredAt?.toISOString() ?? null,
      })),
    };
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
