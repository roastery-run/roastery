/**
 * Persisting espresso shots.
 *
 * The write is a single multi-row upsert per batch, and the whole point of it
 * is the `ON CONFLICT DO NOTHING`: a bar bridge that loses its uplink replays
 * its local buffer, and without dedupe a reconnect would double every shot in
 * the day's report. That is the failure that makes a café dashboard
 * untrustworthy, and it is silent — the numbers still look plausible.
 */
import { cafeMachines, espressoShots, shotRollupsHourly } from "@roastery/db/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { WorkerDb } from "../db/db";
import {
  DEFAULT_SHOT_SPEC,
  hourBucket,
  judgeShot,
  rollUp,
  type ShotSpec,
  type ShotVerdict,
  shotRatio,
} from "./espresso";

export type IncomingShot = {
  externalId: string;
  machineId: string;
  groupNumber?: number;
  pulledAt: string;
  doseG?: number | null;
  yieldG?: number | null;
  durationS?: number | null;
  brewTempC?: number | null;
  peakPressureBar?: number | null;
  grindSetting?: string | null;
  roastedLotId?: string | null;
  blendId?: string | null;
  baristaRef?: string | null;
  /** Set by the bar when a shot was dumped rather than served. */
  discarded?: boolean;
};

export type PreparedShot = {
  orgId: string;
  siteId: string;
  machineId: string;
  groupNumber: number;
  externalId: string;
  pulledAt: Date;
  doseG: string | null;
  yieldG: string | null;
  durationS: string | null;
  brewTempC: string | null;
  peakPressureBar: string | null;
  grindSetting: string | null;
  verdict: ShotVerdict;
  ratio: string | null;
  roastedLotId: string | null;
  blendId: string | null;
  baristaRef: string | null;
};

const g = (v: number | null | undefined, scale: number): string | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : v.toFixed(scale);

/**
 * Judges and normalizes a batch before it touches the database.
 *
 * Pure, so the verdict logic is testable without Postgres, and so an invalid
 * shot is rejected here rather than by a constraint three layers down.
 */
export function prepareShots(
  orgId: string,
  siteId: string,
  shots: IncomingShot[],
  spec: ShotSpec = DEFAULT_SHOT_SPEC,
): PreparedShot[] {
  const prepared: PreparedShot[] = [];

  for (const shot of shots) {
    const pulledAt = new Date(shot.pulledAt);
    if (Number.isNaN(pulledAt.getTime())) continue;

    const measurement = {
      doseG: shot.doseG ?? null,
      yieldG: shot.yieldG ?? null,
      durationS: shot.durationS ?? null,
    };
    const ratio = shotRatio(measurement);

    prepared.push({
      orgId,
      siteId,
      machineId: shot.machineId,
      groupNumber: shot.groupNumber ?? 1,
      externalId: shot.externalId,
      pulledAt,
      doseG: g(measurement.doseG, 2),
      yieldG: g(measurement.yieldG, 2),
      durationS: g(measurement.durationS, 2),
      brewTempC: g(shot.brewTempC, 2),
      peakPressureBar: g(shot.peakPressureBar, 2),
      grindSetting: shot.grindSetting ?? null,
      // A dumped shot is recorded, not dropped: waste is a number the bar
      // manager wants, and deleting it would make the coffee-used figure
      // disagree with the hopper.
      verdict: shot.discarded ? "discarded" : judgeShot(measurement, spec),
      ratio: g(ratio, 3),
      roastedLotId: shot.roastedLotId ?? null,
      blendId: shot.blendId ?? null,
      baristaRef: shot.baristaRef ?? null,
    });
  }

  // A bridge can replay a buffer that overlaps itself. Postgres rejects an
  // INSERT whose own VALUES list hits the same conflict target twice, so the
  // batch is deduplicated before it gets there rather than failing wholesale.
  const seen = new Set<string>();
  return prepared.filter((s) => {
    const key = `${s.machineId}:${s.externalId}:${s.pulledAt.toISOString()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type WriteResult = { received: number; inserted: number; duplicates: number };

/** One multi-row upsert. Chunked, because a single statement has limits too. */
export async function writeShots(db: WorkerDb, shots: PreparedShot[]): Promise<WriteResult> {
  if (!shots.length) return { received: 0, inserted: 0, duplicates: 0 };

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < shots.length; i += CHUNK) {
    const rows = await db
      .insert(espressoShots)
      .values(shots.slice(i, i + CHUNK))
      .onConflictDoNothing()
      .returning({ id: espressoShots.id });
    inserted += rows.length;
  }

  return { received: shots.length, inserted, duplicates: shots.length - inserted };
}

/**
 * Recomputes the hourly rollups touched by a batch.
 *
 * Recomputed from the shots rather than incremented, deliberately. An
 * increment is wrong the moment a late shot arrives from an offline bridge —
 * and it silently stays wrong, because nothing ever recounts. Recomputing an
 * hour is a single indexed scan of a few hundred rows.
 */
export async function refreshRollups(
  db: WorkerDb,
  orgId: string,
  touched: { machineId: string; siteId: string; hour: Date }[],
): Promise<number> {
  const unique = new Map<string, { machineId: string; siteId: string; hour: Date }>();
  for (const t of touched) unique.set(`${t.machineId}:${t.hour.toISOString()}`, t);

  for (const { machineId, siteId, hour } of unique.values()) {
    const next = new Date(hour.getTime() + 3_600_000);
    const rows = await db
      .select({
        doseG: espressoShots.doseG,
        yieldG: espressoShots.yieldG,
        durationS: espressoShots.durationS,
        ratio: espressoShots.ratio,
        verdict: espressoShots.verdict,
      })
      .from(espressoShots)
      .where(
        and(
          eq(espressoShots.orgId, orgId),
          eq(espressoShots.machineId, machineId),
          gte(espressoShots.pulledAt, hour),
          lt(espressoShots.pulledAt, next),
        ),
      );

    const rollup = rollUp(
      rows.map((r) => ({
        doseG: r.doseG === null ? null : Number.parseFloat(r.doseG),
        yieldG: r.yieldG === null ? null : Number.parseFloat(r.yieldG),
        durationS: r.durationS === null ? null : Number.parseFloat(r.durationS),
        ratio: r.ratio === null ? null : Number.parseFloat(r.ratio),
        verdict: r.verdict,
      })),
    );

    await db
      .insert(shotRollupsHourly)
      .values({
        orgId,
        siteId,
        machineId,
        hourStart: hour,
        shotCount: rollup.shotCount,
        inSpecCount: rollup.inSpecCount,
        channelingCount: rollup.channelingCount,
        discardedCount: rollup.discardedCount,
        avgDoseG: rollup.avgDoseG?.toFixed(2) ?? null,
        avgYieldG: rollup.avgYieldG?.toFixed(2) ?? null,
        avgDurationS: rollup.avgDurationS?.toFixed(2) ?? null,
        avgRatio: rollup.avgRatio?.toFixed(3) ?? null,
        stddevDurationS: rollup.stddevDurationS?.toFixed(3) ?? null,
        coffeeUsedKg: rollup.coffeeUsedKg.toFixed(4),
      })
      .onConflictDoUpdate({
        target: [shotRollupsHourly.orgId, shotRollupsHourly.machineId, shotRollupsHourly.hourStart],
        set: {
          shotCount: rollup.shotCount,
          inSpecCount: rollup.inSpecCount,
          channelingCount: rollup.channelingCount,
          discardedCount: rollup.discardedCount,
          avgDoseG: rollup.avgDoseG?.toFixed(2) ?? null,
          avgYieldG: rollup.avgYieldG?.toFixed(2) ?? null,
          avgDurationS: rollup.avgDurationS?.toFixed(2) ?? null,
          avgRatio: rollup.avgRatio?.toFixed(3) ?? null,
          stddevDurationS: rollup.stddevDurationS?.toFixed(3) ?? null,
          coffeeUsedKg: rollup.coffeeUsedKg.toFixed(4),
          updatedAt: new Date(),
        },
      });
  }
  return unique.size;
}

export function touchedHours(
  shots: PreparedShot[],
): { machineId: string; siteId: string; hour: Date }[] {
  return shots.map((s) => ({
    machineId: s.machineId,
    siteId: s.siteId,
    hour: hourBucket(s.pulledAt),
  }));
}

/** Resolves a bar bridge's device id to the machine and site it belongs to. */
export async function resolveCafeMachine(
  db: WorkerDb,
  orgId: string,
  machineId: string,
): Promise<{ machineId: string; siteId: string } | null> {
  const [row] = await db
    .select({ id: cafeMachines.id, siteId: cafeMachines.siteId })
    .from(cafeMachines)
    .where(and(eq(cafeMachines.orgId, orgId), eq(cafeMachines.id, machineId)))
    .limit(1);
  return row ? { machineId: row.id, siteId: row.siteId } : null;
}

/**
 * Creates the partitions the next few months will need.
 *
 * Run from cron. A shot arriving with no matching range would land in the
 * default partition, which works but concentrates everything into one table
 * and defeats the point — so the window is kept ahead rather than relied upon.
 */
export async function ensureShotPartitions(db: WorkerDb, monthsAhead = 3): Promise<string[]> {
  const created: string[] = [];
  const now = new Date();

  for (let offset = 0; offset <= monthsAhead; offset++) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const next = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));
    const name = `espresso_shots_${month.getUTCFullYear()}_${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
    const from = month.toISOString().slice(0, 10);
    const to = next.toISOString().slice(0, 10);

    await db.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF espresso_shots ` +
          `FOR VALUES FROM ('${from}') TO ('${to}')`,
      ),
    );
    created.push(name);
  }
  return created;
}
