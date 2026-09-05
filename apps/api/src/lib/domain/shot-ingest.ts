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

    if (await partitionExists(db, name)) continue;

    /*
     * CREATE TABLE ... PARTITION OF is one statement that both creates and
     * attaches, and attaching FAILS OUTRIGHT while the DEFAULT partition holds
     * any row belonging to the new range. That is not hypothetical: the
     * default exists precisely to catch shots from a bridge with a wrong
     * clock, and one shot dated next month is enough to make next month's
     * partition impossible to create — permanently, since the cron retries the
     * same failing statement every night. Everything then accumulates in the
     * default partition, which is the exact outcome partitioning was for, and
     * the only symptom is a log line.
     *
     * So: create the table detached, move any rows the default already holds
     * for that range into it, and attach. All in one transaction, because a
     * half-done move is rows in two places.
     */
    await withLockRetry(async () =>
      db.transaction(async (tx) => {
        // Never block the shop floor waiting for a lock. ATTACH needs a lock on
        // the parent, and shots are being inserted into it continuously, so the
        // right failure is a fast one that retries rather than a maintenance job
        // that holds up ingest.
        await tx.execute(sql.raw("SET LOCAL lock_timeout = '5s'"));
        await tx.execute(
          sql.raw(`CREATE TABLE IF NOT EXISTS ${name} (LIKE espresso_shots INCLUDING ALL)`),
        );
        await tx.execute(
          sql.raw(
            `WITH moved AS (
             DELETE FROM espresso_shots_overflow
              WHERE pulled_at >= '${from}' AND pulled_at < '${to}'
              RETURNING *
           )
           INSERT INTO ${name} SELECT * FROM moved`,
          ),
        );
        await tx.execute(
          sql.raw(
            `ALTER TABLE espresso_shots ATTACH PARTITION ${name} ` +
              `FOR VALUES FROM ('${from}') TO ('${to}')`,
          ),
        );
      }),
    );
    created.push(name);
  }
  return created;
}

/** Postgres: deadlock detected, and lock timeout. Both mean "try again". */
const RETRYABLE_LOCK_CODES = new Set(["40P01", "55P03"]);
const LOCK_RETRIES = 3;

/**
 * Retries work that lost a lock race.
 *
 * Attaching a partition contends with ordinary traffic on the same table —
 * inserts from every bar, and the cascading deletes that follow an
 * organization being removed. Postgres resolves a deadlock by killing one
 * side, and there is no reason that side should be the roll-forward: it is
 * idempotent, nothing is waiting on it, and the alternative is a month with no
 * partition until somebody notices.
 */
async function withLockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (err) {
      const code =
        (err as { cause?: { code?: string }; code?: string }).cause?.code ??
        (err as { code?: string }).code;
      if (!code || !RETRYABLE_LOCK_CODES.has(code) || attempt >= LOCK_RETRIES) throw err;
      // Short, increasing, and jittered so two Workers retrying do not collide
      // again on the same schedule.
      await new Promise((resolve) => setTimeout(resolve, attempt * 250 + Math.random() * 250));
    }
  }
}

async function partitionExists(db: WorkerDb, name: string): Promise<boolean> {
  const rows = await db.execute<{ exists: boolean }>(
    sql`select to_regclass(${`public.${name}`}) is not null as exists`,
  );
  return [...rows][0]?.exists === true;
}
