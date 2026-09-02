import { roastBatches, roastEvents, roastSamples } from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import type { Env } from "../../env";
import type { OrgDb } from "../db/org-db";

/**
 * Moves a finished roast out of the Durable Object and into durable storage.
 *
 * Three representations, each answering a different question — see the comment
 * on packages/db/src/schema/production.ts for why. In short: a preview for
 * lists, a 1 Hz downsample for SQL, and the full curve in R2.
 */

export type RawCurve = {
  samples: {
    t: number;
    bt: number;
    et: number | null;
    ror: number | null;
    gas: number | null;
    airflow: number | null;
  }[];
  events: { t: number; kind: string; note: string | null }[];
};

/** Roughly how many points a preview chart can usefully show. */
const PREVIEW_POINTS = 120;
/** Postgres keeps one sample per second; enough for every SQL question asked. */
const DOWNSAMPLE_HZ = 1;

/**
 * Largest-Triangle-Three-Buckets.
 *
 * Picks the points that preserve a curve's SHAPE rather than every Nth point,
 * which is what keeps the first-crack inflection visible in a 120-point
 * preview. Naive decimation routinely drops exactly the sample a roaster is
 * looking for.
 */
export function downsampleLTTB(
  points: { x: number; y: number }[],
  target: number,
): { x: number; y: number }[] {
  if (target >= points.length || target < 3) return points;

  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return points;

  const out = [first];
  const bucketSize = (points.length - 2) / (target - 2);
  let a = 0;

  for (let i = 0; i < target - 2; i++) {
    const rangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const rangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, points.length - 1);

    // Average of the NEXT bucket, used as the third triangle vertex.
    let avgX = 0;
    let avgY = 0;
    let count = 0;
    for (let j = rangeStart; j < rangeEnd; j++) {
      const p = points[j];
      if (!p) continue;
      avgX += p.x;
      avgY += p.y;
      count++;
    }
    if (count > 0) {
      avgX /= count;
      avgY /= count;
    }

    const from = Math.floor(i * bucketSize) + 1;
    const to = Math.floor((i + 1) * bucketSize) + 1;
    const anchor = points[a];
    if (!anchor) continue;

    let bestArea = -1;
    let best = from;
    for (let j = from; j < to && j < points.length; j++) {
      const p = points[j];
      if (!p) continue;
      const area = Math.abs(
        (anchor.x - avgX) * (p.y - anchor.y) - (anchor.x - p.x) * (avgY - anchor.y),
      );
      if (area > bestArea) {
        bestArea = area;
        best = j;
      }
    }
    const chosen = points[best];
    if (chosen) out.push(chosen);
    a = best;
  }

  out.push(last);
  return out;
}

/** One sample per second, for the queryable copy in Postgres. */
export function downsampleToHz(curve: RawCurve["samples"], hz: number) {
  const step = 1 / hz;
  const kept: RawCurve["samples"] = [];
  let nextT = 0;
  for (const s of curve) {
    if (s.t + 1e-9 >= nextT) {
      kept.push(s);
      nextT = s.t + step;
    }
  }
  return kept;
}

/** The struct-of-arrays preview stored on the batch row. */
export function buildPreview(samples: RawCurve["samples"]) {
  const bt = downsampleLTTB(
    samples.map((s) => ({ x: s.t, y: s.bt })),
    PREVIEW_POINTS,
  );
  const times = bt.map((p) => p.x);
  const byTime = new Map(samples.map((s) => [s.t, s]));
  return {
    // Struct-of-arrays, not array-of-objects: ~5x smaller and ~3x faster to
    // parse, which matters because this is loaded for every row in a list.
    t: times,
    bt: bt.map((p) => round2(p.y)),
    et: times.map((t) => round2(byTime.get(t)?.et ?? 0)),
    ror: times.map((t) => round2(byTime.get(t)?.ror ?? 0)),
  };
}

export function curveObjectKey(orgId: string, batchId: string): string {
  // Tenant-prefixed, so a bucket listing can never cross organizations.
  return `roasts/${orgId}/${batchId}.json.gz`;
}

/** Writes the full-fidelity curve to R2, gzip-compressed. */
export async function writeCurveToR2(
  env: Env,
  orgId: string,
  batchId: string,
  curve: RawCurve,
): Promise<string> {
  const key = curveObjectKey(orgId, batchId);
  const body = JSON.stringify({
    schema: ["t", "bt", "et", "ror", "gas", "airflow"],
    samples: curve.samples.map((s) => [s.t, s.bt, s.et, s.ror, s.gas, s.airflow]),
    events: curve.events,
  });

  // R2.put refuses a stream of unknown length, and a CompressionStream's
  // output has none — so the compressed bytes are buffered first. A roast
  // curve is a few hundred kilobytes before compression, so this is bounded
  // and cheap; streaming would only matter for objects far larger than this.
  const compressed = new Response(
    new Response(body).body?.pipeThrough(new CompressionStream("gzip")),
  );
  const bytes = await compressed.arrayBuffer();

  await env.ROASTERY_R2.put(key, bytes, {
    httpMetadata: { contentType: "application/json", contentEncoding: "gzip" },
  });
  return key;
}

export type RoastMetrics = {
  totalTimeS: number | null;
  firstCrackS: number | null;
  dryEndS: number | null;
  developmentTimeS: number | null;
  dtrPct: string | null;
  dropTempC: string | null;
  maxRorCPerMin: string | null;
};

/** The numbers a batch is judged on, derived from the curve and its events. */
export function deriveMetrics(curve: RawCurve): RoastMetrics {
  const at = (kind: string) => curve.events.find((e) => e.kind === kind)?.t ?? null;
  const drop = at("drop") ?? curve.samples.at(-1)?.t ?? null;
  const firstCrack = at("first_crack_start");
  const development = firstCrack !== null && drop !== null ? drop - firstCrack : null;

  return {
    totalTimeS: drop === null ? null : Math.round(drop),
    firstCrackS: firstCrack === null ? null : Math.round(firstCrack),
    dryEndS: at("dry_end") === null ? null : Math.round(at("dry_end") as number),
    developmentTimeS: development === null ? null : Math.round(development),
    // Development time ratio: the share of the roast after first crack.
    dtrPct: development === null || !drop ? null : ((development / drop) * 100).toFixed(2),
    dropTempC: curve.samples.at(-1)?.bt?.toFixed(2) ?? null,
    maxRorCPerMin:
      curve.samples.length === 0
        ? null
        : Math.max(...curve.samples.map((s) => s.ror ?? 0)).toFixed(3),
  };
}

/**
 * Persists a finished roast.
 *
 * Order matters: the R2 object and the Postgres rows are written BEFORE the
 * Durable Object's buffer is discarded, so a failure anywhere leaves the curve
 * recoverable from the DO rather than lost.
 */
export async function flushRoast(
  env: Env,
  db: OrgDb,
  batchId: string,
  curve: RawCurve,
  final: { dropWeightKg?: string | null } = {},
): Promise<{ sampleCount: number; curveObjectKey: string }> {
  const key = await writeCurveToR2(env, db.orgId, batchId, curve);
  const metrics = deriveMetrics(curve);
  const downsampled = downsampleToHz(curve.samples, DOWNSAMPLE_HZ);

  await db.transaction(async (tx) => {
    if (downsampled.length) {
      // unscoped-ok: roast_samples is TENANT_VIA — no org column, reached
      // through its batch. See packages/db/src/tenancy.ts.
      await tx.query(async (t) =>
        t
          .insert(roastSamples)
          .values(
            downsampled.map((s) => ({
              batchId,
              t: s.t.toFixed(2),
              beanTempC: s.bt?.toFixed(2) ?? null,
              envTempC: s.et?.toFixed(2) ?? null,
              rorCPerMin: s.ror?.toFixed(3) ?? null,
              gasPct: s.gas?.toFixed(2) ?? null,
              airflowPct: s.airflow?.toFixed(2) ?? null,
            })),
          )
          // Re-running a flush must not duplicate the curve.
          .onConflictDoNothing(),
      );
    }

    if (curve.events.length) {
      // unscoped-ok: roast_events is TENANT_VIA — it carries no org column at
      // all, reaching the tenant through its batch, which the update below
      // scopes. Hundreds of rows per roast is exactly why it is not
      // denormalized.
      await tx.query(async (t) =>
        t.insert(roastEvents).values(
          curve.events.map((e) => ({
            batchId,
            kind: e.kind as typeof roastEvents.$inferInsert.kind,
            atSeconds: e.t.toFixed(2),
            note: e.note,
          })),
        ),
      );
    }

    const dropWeight = final.dropWeightKg ?? null;

    // Weight loss is the headline quality number for a batch, and it can only
    // be computed once both weights are known — so it is derived here rather
    // than stored by whichever screen happened to enter the second one.
    const existing = await tx.findOne(roastBatches, eq(roastBatches.id, batchId));
    const weightLossPct =
      existing?.chargeWeightKg && dropWeight
        ? (
            ((Number.parseFloat(existing.chargeWeightKg) - Number.parseFloat(dropWeight)) /
              Number.parseFloat(existing.chargeWeightKg)) *
            100
          ).toFixed(3)
        : null;

    await tx.update(
      roastBatches,
      {
        status: "completed",
        endedAt: new Date(),
        curvePreview: buildPreview(curve.samples),
        curveObjectKey: key,
        sampleCount: curve.samples.length,
        totalTimeS: metrics.totalTimeS,
        firstCrackS: metrics.firstCrackS,
        dryEndS: metrics.dryEndS,
        developmentTimeS: metrics.developmentTimeS,
        dtrPct: metrics.dtrPct,
        dropTempC: metrics.dropTempC,
        maxRorCPerMin: metrics.maxRorCPerMin,
        ...(dropWeight ? { dropWeightKg: dropWeight } : {}),
        ...(weightLossPct ? { weightLossPct } : {}),
        updatedAt: new Date(),
      },
      eq(roastBatches.id, batchId),
    );
  });

  return { sampleCount: curve.samples.length, curveObjectKey: key };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
