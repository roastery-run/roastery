/**
 * Point-of-sale import and reconciliation.
 *
 * Two observations of the same event — a shot the machine reported and a sale
 * the till recorded — kept in separate tables on purpose. The difference
 * between them IS the finding: a sale with no shot is a till error or a machine
 * that stopped reporting, and a shot with no sale is either waste or theft.
 * Merging them at import would erase the question the whole feature exists to
 * ask.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { cafeSites, espressoShots, posReconciliations, posTransactions } from "@roastery/db/schema";
import {
  importPosSalesInput,
  importPosSalesOutput,
  listReconciliationsInput,
  listReconciliationsOutput,
  posReconciliationSchema,
  reconcilePosInput,
} from "@roastery/schemas";
import { and, eq, gte, lt, type SQL, sql } from "drizzle-orm";
import { BadRequest, NotFound } from "../../lib/api/errors";
import { type RpcAppEnv, registerRpc } from "../../lib/api/rpc";

export const cafePos = new OpenAPIHono<RpcAppEnv>();

/** Variance within this is normal shrinkage, not a finding worth raising. */
const TOLERANCE_PCT = 5;

registerRpc(
  cafePos,
  {
    namespace: "cafe",
    operation: "importPosSales",
    summary: "Import sales lines from a point-of-sale system",
    description:
      "Idempotent on the POS system's own line id, so re-importing a day — which every " +
      "reconciliation job eventually does — adds nothing.",
    input: importPosSalesInput,
    output: importPosSalesOutput,
    permission: "cafe.ingest",
    module: "cafe",
  },
  async (input, ctx) => {
    const site = await ctx.db.findOne(cafeSites, eq(cafeSites.id, input.siteId));
    if (!site) throw new NotFound("Site not found");

    // unscoped-ok: an INSERT, not a read. There is nothing to filter — the
    // tenant is WRITTEN from ctx.orgId below, and OrgDb.insert() cannot be
    // used because this needs onConflictDoNothing for idempotent re-import.
    const inserted = await ctx.db.query(async (t) =>
      t
        .insert(posTransactions)
        .values(
          input.lines.map((line) => ({
            orgId: ctx.orgId,
            siteId: input.siteId,
            externalId: line.externalId,
            soldAt: new Date(line.soldAt),
            itemName: line.itemName,
            shotEquivalents: line.shotEquivalents,
            quantity: line.quantity,
            grossAmount: line.grossAmount ?? null,
            currency: line.currency ?? null,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: posTransactions.id }),
    );

    return {
      siteId: input.siteId,
      received: input.lines.length,
      imported: inserted.length,
      duplicates: input.lines.length - inserted.length,
    };
  },
);

registerRpc(
  cafePos,
  {
    namespace: "cafe",
    operation: "reconcilePos",
    summary: "Compare shots pulled against coffee sold",
    description:
      "Counts shots and sale shot-equivalents for one business day and records the " +
      "variance. A positive variance is coffee pulled but not sold — waste, comps or " +
      "theft; a negative one means the till saw sales the machines did not report, which " +
      "usually means a bridge is down.",
    input: reconcilePosInput,
    output: posReconciliationSchema,
    permission: "cafe.write",
    module: "cafe",
  },
  async (input, ctx) => {
    const site = await ctx.db.findOne(cafeSites, eq(cafeSites.id, input.siteId));
    if (!site) throw new NotFound("Site not found");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)) {
      throw new BadRequest("businessDate must be YYYY-MM-DD");
    }

    // The day is bounded in UTC here. A site's real business day is local and
    // often runs past midnight; that belongs with the timezone work rather
    // than being half-done with an offset guess.
    const from = new Date(`${input.businessDate}T00:00:00.000Z`);
    const to = new Date(from.getTime() + 86_400_000);

    const [shotRow] = await ctx.db.query(async (t, scope) =>
      t
        .select({ n: sql<number>`count(*)::int` })
        .from(espressoShots)
        .where(
          and(
            scope(espressoShots),
            eq(espressoShots.siteId, input.siteId),
            gte(espressoShots.pulledAt, from),
            lt(espressoShots.pulledAt, to),
            // A dumped shot was never sellable, so counting it as an unsold
            // shot would report waste twice.
            sql`${espressoShots.verdict} <> 'discarded'`,
          ),
        ),
    );

    const [saleRow] = await ctx.db.query(async (t, scope) =>
      t
        .select({
          n: sql<number>`coalesce(sum(${posTransactions.shotEquivalents} * ${posTransactions.quantity}), 0)::int`,
        })
        .from(posTransactions)
        .where(
          and(
            scope(posTransactions),
            eq(posTransactions.siteId, input.siteId),
            gte(posTransactions.soldAt, from),
            lt(posTransactions.soldAt, to),
          ),
        ),
    );

    const shotCount = shotRow?.n ?? 0;
    const saleShotEquivalents = saleRow?.n ?? 0;
    const variance = shotCount - saleShotEquivalents;
    const basis = Math.max(shotCount, saleShotEquivalents);
    const variancePct = basis === 0 ? 0 : (variance / basis) * 100;

    const status =
      basis === 0
        ? "pending"
        : Math.abs(variancePct) <= TOLERANCE_PCT
          ? "matched"
          : variance > 0
            ? "sale_missing"
            : "shot_missing";

    const row = await ctx.db.transaction(async (tx) => {
      // unscoped-ok: an UPSERT, not a read. orgId is written from ctx.orgId,
      // and the conflict target includes it, so a conflict can only ever match
      // a row this organization already owns.
      const [saved] = await tx.query(async (t) =>
        t
          .insert(posReconciliations)
          .values({
            orgId: ctx.orgId,
            siteId: input.siteId,
            businessDate: input.businessDate,
            status,
            shotCount,
            saleShotEquivalents,
            variance,
            variancePct: variancePct.toFixed(3),
            notes:
              status === "sale_missing"
                ? `${variance} shots pulled with no matching sale`
                : status === "shot_missing"
                  ? `${-variance} sold shots the machines did not report — check the bar bridge`
                  : null,
          })
          .onConflictDoUpdate({
            target: [
              posReconciliations.orgId,
              posReconciliations.siteId,
              posReconciliations.businessDate,
            ],
            set: {
              status,
              shotCount,
              saleShotEquivalents,
              variance,
              variancePct: variancePct.toFixed(3),
            },
          })
          .returning(),
      );
      if (!saved) throw new Error("Upsert returned no row");

      await tx.emit({
        type: "cafe.pos.reconciled",
        resourceType: "pos_reconciliation",
        resourceId: saved.id,
        payload: {
          id: saved.id,
          siteId: input.siteId,
          businessDate: input.businessDate,
          status,
          variance,
        },
      });
      return saved;
    });

    return {
      id: row.id,
      siteId: row.siteId,
      businessDate: row.businessDate,
      status: row.status,
      shotCount: row.shotCount,
      saleShotEquivalents: row.saleShotEquivalents,
      variance: row.variance,
      variancePct: row.variancePct ?? null,
      notes: row.notes ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  },
);

registerRpc(
  cafePos,
  {
    namespace: "cafe",
    operation: "listReconciliations",
    summary: "Past reconciliations",
    description:
      "A single day's variance says little on its own. A consistent 8% is a " +
      "process problem; one bad Tuesday is a bad Tuesday, and only the " +
      "history distinguishes them.",
    input: listReconciliationsInput,
    output: listReconciliationsOutput,
    permission: "cafe.read",
    module: "cafe",
    cacheable: { maxAgeSeconds: 30 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter?.siteId) clauses.push(eq(posReconciliations.siteId, input.filter.siteId));
    if (input.filter?.status) clauses.push(eq(posReconciliations.status, input.filter.status));

    const { items, page } = await ctx.db.find(posReconciliations, {
      where: clauses.length ? and(...clauses) : undefined,
      cursor: input.page?.cursor,
      limit: input.page?.limit,
    });

    return {
      items: items.map((row) => ({
        id: row.id,
        siteId: row.siteId,
        businessDate: row.businessDate,
        status: row.status,
        shotCount: row.shotCount,
        saleShotEquivalents: row.saleShotEquivalents,
        variance: row.variance,
        variancePct: row.variancePct ?? null,
        notes: row.notes ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      page,
    };
  },
);
