/**
 * Turning a report kind and its parameters into a document.
 *
 * Each builder reads through the caller's OrgDb, so a report can never contain
 * another tenant's rows — the same scoping path as every request, rather than
 * a second set of queries written for reporting and forgotten about.
 */
import {
  cafeSites,
  greenLots,
  roastBatches,
  roastedLots,
  shotRollupsHourly,
  traceabilityRecords,
} from "@roastery/db/schema";
import { and, asc, desc, eq, gte, lte, type SQL } from "drizzle-orm";
import { NotFound } from "../api/errors";
import type { OrgDb } from "../db/org-db";
import type { ReportDocument, ReportSection } from "./render";

type BuildContext = { db: OrgDb; orgId: string };
type Params = Record<string, string | undefined>;

const nz = (v: string | null | undefined, fallback = "—") => v ?? fallback;

export async function buildReport(
  ctx: BuildContext,
  kind: string,
  params: Params,
): Promise<ReportDocument> {
  const generatedAt = new Date().toISOString();
  const base = { generatedAt, organization: ctx.orgId };

  switch (kind) {
    case "inventory_valuation":
      return { ...base, title: "Inventory valuation", sections: await inventoryValuation(ctx) };
    case "production_summary":
      return {
        ...base,
        title: "Production summary",
        subtitle: window(params),
        sections: await productionSummary(ctx, params),
      };
    case "quality_summary":
      return {
        ...base,
        title: "Quality summary",
        subtitle: window(params),
        sections: await qualitySummary(ctx, params),
      };
    case "cafe_performance":
      return {
        ...base,
        title: "Café performance",
        subtitle: window(params),
        sections: await cafePerformance(ctx, params),
      };
    case "traceability_certificate":
      return {
        ...base,
        title: "Traceability certificate",
        sections: await certificate(ctx, params),
      };
    default:
      throw new NotFound(`Unknown report kind "${kind}"`);
  }
}

function window(params: Params): string {
  if (!params.from && !params.to) return "All time";
  return `${params.from ?? "the beginning"} to ${params.to ?? "now"}`;
}

function range(column: SQL | never, params: Params): SQL[] {
  const clauses: SQL[] = [];
  if (params.from) clauses.push(gte(column as never, new Date(params.from)));
  if (params.to) clauses.push(lte(column as never, new Date(params.to)));
  return clauses;
}

async function inventoryValuation(ctx: BuildContext): Promise<ReportSection[]> {
  const green = await ctx.db.query(async (t, scope) =>
    t
      .select()
      .from(greenLots)
      .where(and(scope(greenLots), eq(greenLots.status, "available")))
      .orderBy(desc(greenLots.currentWeightKg))
      .limit(500),
  );

  const roasted = await ctx.db.query(async (t, scope) =>
    t
      .select()
      .from(roastedLots)
      .where(and(scope(roastedLots), eq(roastedLots.status, "available")))
      .orderBy(desc(roastedLots.currentWeightKg))
      .limit(500),
  );

  const greenTotal = green.reduce((s, l) => s + Number.parseFloat(l.currentWeightKg ?? "0"), 0);
  const greenValue = green.reduce((s, l) => s + Number.parseFloat(l.totalValueBase ?? "0"), 0);

  return [
    {
      heading: "Green coffee",
      rows: [
        ["Lot", "Code", "Weight (kg)", "Value"],
        ...green.map((l) => [l.name, l.lotCode, nz(l.currentWeightKg, "0"), nz(l.totalValueBase)]),
      ],
      note: `${green.length} lots · ${greenTotal.toFixed(4)} kg · ${greenValue.toFixed(2)} total`,
    },
    {
      heading: "Roasted coffee",
      rows: [
        ["Lot", "Code", "Available (kg)", "Reserved (kg)", "Best before"],
        ...roasted.map((l) => [
          l.name,
          l.lotCode,
          nz(l.currentWeightKg, "0"),
          nz(l.reservedWeightKg, "0"),
          l.bestBeforeAt?.toISOString().slice(0, 10) ?? "—",
        ]),
      ],
      note: `${roasted.length} lots`,
    },
  ];
}

async function productionSummary(ctx: BuildContext, params: Params): Promise<ReportSection[]> {
  const batches = await ctx.db.query(async (t, scope) =>
    t
      .select()
      .from(roastBatches)
      .where(and(scope(roastBatches), ...range(roastBatches.startedAt as never, params)))
      .orderBy(desc(roastBatches.startedAt))
      .limit(1000),
  );

  const completed = batches.filter((b) => b.status === "completed");
  const charged = completed.reduce((s, b) => s + Number.parseFloat(b.chargeWeightKg ?? "0"), 0);
  const dropped = completed.reduce((s, b) => s + Number.parseFloat(b.dropWeightKg ?? "0"), 0);

  return [
    {
      heading: "Batches",
      rows: [
        ["Batch", "Started", "Charge (kg)", "Drop (kg)", "Loss %", "DTR %"],
        ...batches.map((b) => [
          b.batchNumber,
          b.startedAt?.toISOString().slice(0, 16).replace("T", " ") ?? "—",
          nz(b.chargeWeightKg),
          nz(b.dropWeightKg),
          nz(b.weightLossPct),
          nz(b.dtrPct),
        ]),
      ],
      note:
        `${completed.length} completed of ${batches.length} · ${charged.toFixed(2)} kg charged ` +
        `→ ${dropped.toFixed(2)} kg roasted` +
        (charged > 0 ? ` (${(((charged - dropped) / charged) * 100).toFixed(2)}% loss)` : ""),
    },
  ];
}

async function qualitySummary(ctx: BuildContext, params: Params): Promise<ReportSection[]> {
  const batches = await ctx.db.query(async (t, scope) =>
    t
      .select()
      .from(roastBatches)
      .where(
        and(
          scope(roastBatches),
          eq(roastBatches.status, "completed"),
          ...range(roastBatches.startedAt as never, params),
        ),
      )
      .orderBy(desc(roastBatches.startedAt))
      .limit(1000),
  );

  const withDtr = batches.filter((b) => b.dtrPct !== null);
  const dtrValues = withDtr.map((b) => Number.parseFloat(b.dtrPct ?? "0"));
  const avgDtr = dtrValues.length ? dtrValues.reduce((a, b) => a + b, 0) / dtrValues.length : null;

  return [
    {
      heading: "Roast consistency",
      rows: [
        ["Batch", "Drop temp (°C)", "Total time (s)", "DTR %", "Loss %"],
        ...withDtr.map((b) => [
          b.batchNumber,
          nz(b.dropTempC),
          b.totalTimeS === null ? "—" : String(b.totalTimeS),
          nz(b.dtrPct),
          nz(b.weightLossPct),
        ]),
      ],
      // The spread, not just the mean: a roastery averaging 20% DTR with every
      // batch within a point is in control; the same average from 12% and 28%
      // is not, and only one of those is worth reporting as a success.
      note:
        avgDtr === null
          ? "No completed batches with a development time ratio in this window."
          : `${withDtr.length} batches · average DTR ${avgDtr.toFixed(2)}% · spread ${(
              Math.max(...dtrValues) - Math.min(...dtrValues)
            ).toFixed(2)} points`,
    },
  ];
}

async function cafePerformance(ctx: BuildContext, params: Params): Promise<ReportSection[]> {
  const clauses: SQL[] = [];
  if (params.siteId) clauses.push(eq(shotRollupsHourly.siteId, params.siteId));
  if (params.from) clauses.push(gte(shotRollupsHourly.hourStart, new Date(params.from)));
  if (params.to) clauses.push(lte(shotRollupsHourly.hourStart, new Date(params.to)));

  const rollups = await ctx.db.query(async (t, scope) =>
    t
      .select()
      .from(shotRollupsHourly)
      .where(and(scope(shotRollupsHourly), ...clauses))
      .orderBy(asc(shotRollupsHourly.hourStart))
      .limit(2000),
  );

  const sites = await ctx.db.query(async (t, scope) =>
    t.select().from(cafeSites).where(scope(cafeSites)),
  );
  const siteName = new Map(sites.map((s) => [s.id, s.name]));

  const shots = rollups.reduce((s, r) => s + r.shotCount, 0);
  const inSpec = rollups.reduce((s, r) => s + r.inSpecCount, 0);
  const channeling = rollups.reduce((s, r) => s + r.channelingCount, 0);
  const coffee = rollups.reduce((s, r) => s + Number.parseFloat(r.coffeeUsedKg ?? "0"), 0);

  return [
    {
      heading: "By hour",
      rows: [
        ["Hour", "Site", "Shots", "In spec", "Channeling", "Avg time (s)", "Consistency (σ)"],
        ...rollups.map((r) => [
          r.hourStart.toISOString().slice(0, 16).replace("T", " "),
          siteName.get(r.siteId) ?? r.siteId,
          String(r.shotCount),
          String(r.inSpecCount),
          String(r.channelingCount),
          nz(r.avgDurationS),
          nz(r.stddevDurationS),
        ]),
      ],
      note:
        shots === 0
          ? "No shots in this window."
          : `${shots} shots · ${((inSpec / shots) * 100).toFixed(1)}% in spec · ` +
            `${((channeling / shots) * 100).toFixed(1)}% channeling · ${coffee.toFixed(3)} kg used`,
    },
  ];
}

async function certificate(ctx: BuildContext, params: Params): Promise<ReportSection[]> {
  if (!params.roastedLotId) throw new NotFound("A traceability certificate needs a roastedLotId");

  const [record] = await ctx.db.query(async (t, scope) =>
    t
      .select()
      .from(traceabilityRecords)
      .where(
        and(
          scope(traceabilityRecords),
          eq(traceabilityRecords.roastedLotId, params.roastedLotId as string),
        ),
      )
      .orderBy(desc(traceabilityRecords.issuedAt))
      .limit(1),
  );
  if (!record) throw new NotFound("No certificate has been issued for this lot");

  const snapshot = record.snapshot as {
    coffee: { name: string; lotCode: string; roastLevel: string | null; roastedAt: string | null };
    origins: {
      producer: string | null;
      country: string | null;
      region: string | null;
      altitude: string | null;
      process: string | null;
      varieties: string[];
    }[];
    roast: { batchNumber: string; roastedAt: string | null; weightLossPct: string | null } | null;
  };
  const chain = record.chain as { nodes: { kind: string; id: string; label: string }[] };

  return [
    {
      heading: "Coffee",
      rows: [
        ["Field", "Value"],
        ["Name", snapshot.coffee.name],
        ["Lot code", snapshot.coffee.lotCode],
        ["Roast level", nz(snapshot.coffee.roastLevel)],
        ["Roasted", snapshot.coffee.roastedAt?.slice(0, 10) ?? "—"],
        ["Certificate", record.qrToken],
      ],
    },
    {
      heading: "Origin",
      rows: [
        ["Producer", "Country", "Region", "Altitude", "Process", "Varieties"],
        ...snapshot.origins.map((o) => [
          nz(o.producer),
          nz(o.country),
          nz(o.region),
          nz(o.altitude),
          nz(o.process),
          o.varieties.join(", ") || "—",
        ]),
      ],
    },
    {
      heading: "Chain of custody",
      rows: [["Stage", "Identity"], ...chain.nodes.map((n) => [n.kind, n.label])],
      note: `Frozen at ${record.issuedAt.toISOString()}. Lots merged or split after this date do not change it.`,
    },
  ];
}
