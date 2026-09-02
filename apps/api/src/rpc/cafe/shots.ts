/**
 * Reading shots: the live bar, the hourly rollups, and the raw rows.
 *
 * Writing happens through /ingest/v1/cafe/shots and the shot queue, not here —
 * a bar bridge posting every 28 seconds must not go through the business API's
 * authorization chain and rate budget.
 */
import { OpenAPIHono } from "@hono/zod-openapi";
import { espressoShots, shotRollupsHourly } from "@roastery/db/schema";
import {
  listShotsInput,
  listShotsOutput,
  liveBarInput,
  liveBarOutput,
  sitePerformanceInput,
  sitePerformanceOutput,
} from "@roastery/schemas";
import { and, asc, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import type { CafeSiteDO } from "../../durable-objects/cafe-site";
import { type RpcAppEnv, registerRpc } from "../../lib/api/rpc";

export const cafeShots = new OpenAPIHono<RpcAppEnv>();

registerRpc(
  cafeShots,
  {
    namespace: "cafe",
    operation: "listShots",
    summary: "Individual shots",
    description:
      "The raw rows, for investigating something the rollups surfaced. A time window is " +
      "required: this is the highest-volume table in the system, and an unbounded query " +
      "against it is never what anyone meant.",
    input: listShotsInput,
    output: listShotsOutput,
    permission: "cafe.read",
    module: "cafe",
    cacheable: { maxAgeSeconds: 15 },
  },
  async (input, ctx) => {
    const clauses: SQL[] = [];
    if (input.filter.siteId) clauses.push(eq(espressoShots.siteId, input.filter.siteId));
    if (input.filter.machineId) clauses.push(eq(espressoShots.machineId, input.filter.machineId));
    if (input.filter.verdict) clauses.push(eq(espressoShots.verdict, input.filter.verdict));
    if (input.filter.from) clauses.push(gte(espressoShots.pulledAt, new Date(input.filter.from)));
    if (input.filter.to) clauses.push(lte(espressoShots.pulledAt, new Date(input.filter.to)));

    const rows = await ctx.db.query(async (t, scope) =>
      t
        .select()
        .from(espressoShots)
        .where(and(scope(espressoShots), ...clauses))
        .orderBy(desc(espressoShots.pulledAt))
        .limit(input.limit + 1),
    );

    const hasMore = rows.length > input.limit;
    return {
      items: (hasMore ? rows.slice(0, input.limit) : rows).map((s) => ({
        id: s.id,
        siteId: s.siteId,
        machineId: s.machineId,
        groupNumber: s.groupNumber,
        externalId: s.externalId,
        pulledAt: s.pulledAt.toISOString(),
        doseG: s.doseG ?? null,
        yieldG: s.yieldG ?? null,
        durationS: s.durationS ?? null,
        ratio: s.ratio ?? null,
        verdict: s.verdict,
        roastedLotId: s.roastedLotId ?? null,
        blendId: s.blendId ?? null,
        baristaRef: s.baristaRef ?? null,
      })),
      hasMore,
    };
  },
);

registerRpc(
  cafeShots,
  {
    namespace: "cafe",
    operation: "getSitePerformance",
    summary: "How a site has been running",
    description:
      "Reads the hourly rollups, never the shots. A busy chain produces millions of " +
      "shots a year and every dashboard would otherwise scan them.",
    input: sitePerformanceInput,
    output: sitePerformanceOutput,
    permission: "cafe.read",
    module: "cafe",
    cacheable: { maxAgeSeconds: 60 },
  },
  async (input, ctx) => {
    const rows = await ctx.db.query(async (t, scope) =>
      t
        .select()
        .from(shotRollupsHourly)
        .where(
          and(
            scope(shotRollupsHourly),
            eq(shotRollupsHourly.siteId, input.siteId),
            gte(shotRollupsHourly.hourStart, new Date(input.from)),
            lte(shotRollupsHourly.hourStart, new Date(input.to)),
          ),
        )
        .orderBy(asc(shotRollupsHourly.hourStart)),
    );

    const shotCount = rows.reduce((sum, r) => sum + r.shotCount, 0);
    const inSpec = rows.reduce((sum, r) => sum + r.inSpecCount, 0);
    const channeling = rows.reduce((sum, r) => sum + r.channelingCount, 0);
    const coffeeUsed = rows.reduce((sum, r) => sum + Number.parseFloat(r.coffeeUsedKg ?? "0"), 0);

    return {
      siteId: input.siteId,
      from: input.from,
      to: input.to,
      shotCount,
      // Null rather than 100% for a site with no shots: a bar that was closed
      // did not run perfectly, and reporting it as such puts a misleading
      // green number at the top of a dashboard.
      inSpecPct: shotCount ? Math.round((inSpec / shotCount) * 1000) / 10 : null,
      channelingPct: shotCount ? Math.round((channeling / shotCount) * 1000) / 10 : null,
      coffeeUsedKg: coffeeUsed.toFixed(4),
      hours: rows.map((r) => ({
        siteId: r.siteId,
        machineId: r.machineId,
        hourStart: r.hourStart.toISOString(),
        shotCount: r.shotCount,
        inSpecCount: r.inSpecCount,
        channelingCount: r.channelingCount,
        discardedCount: r.discardedCount,
        avgDoseG: r.avgDoseG ?? null,
        avgYieldG: r.avgYieldG ?? null,
        avgDurationS: r.avgDurationS ?? null,
        avgRatio: r.avgRatio ?? null,
        stddevDurationS: r.stddevDurationS ?? null,
        coffeeUsedKg: r.coffeeUsedKg ?? null,
      })),
    };
  },
);

registerRpc(
  cafeShots,
  {
    namespace: "cafe",
    operation: "getLiveBar",
    summary: "What is happening at the bar right now",
    description:
      "The last five minutes and any group head currently going wrong, read from the " +
      "site's live session rather than the database — the point is to answer in seconds, " +
      "not on the next rollup.",
    input: liveBarInput,
    output: liveBarOutput,
    permission: "cafe.read",
    module: "cafe",
  },
  async (input, ctx) => {
    const stub = ctx.env.CAFE_SITE.get(
      ctx.env.CAFE_SITE.idFromName(`${ctx.orgId}:${input.siteId}`),
    ) as unknown as CafeSiteDO;

    const snapshot = await stub.snapshot();
    return {
      siteId: input.siteId,
      watchers: snapshot.watchers,
      shots: snapshot.shots.map((s) => ({
        externalId: s.externalId,
        machineId: s.machineId,
        groupNumber: s.groupNumber,
        pulledAt: s.pulledAt,
        doseG: s.doseG,
        yieldG: s.yieldG,
        durationS: s.durationS,
        ratio: s.ratio,
        verdict: s.verdict,
      })),
      anomalies: snapshot.anomalies,
    };
  },
);
