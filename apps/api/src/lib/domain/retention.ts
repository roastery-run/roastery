/**
 * Deleting what no longer needs keeping.
 *
 * Nothing in the system deleted anything. The outbox, every webhook delivery
 * attempt, every alert notification and every expired session accumulated
 * forever — and `events` plus `webhook_deliveries` are the pair that grows
 * fastest, because one event with five subscribers is six rows. On a Neon
 * branch with a size limit, the first symptom of that is writes failing across
 * the whole product for reasons that have nothing to do with what anybody was
 * doing.
 *
 * The windows below are stated as one table because they are a policy, not an
 * implementation detail: somebody asking "how long do you keep webhook
 * payloads" should find the answer in one place, and the privacy policy quotes
 * these numbers.
 *
 * What is NOT deleted matters as much. Audit records stay for the life of the
 * account: they are the answer to "who made themselves an owner", and a
 * retention window on them is a window in which that question stops having an
 * answer. Operational records — lots, roasts, orders, certificates — stay too.
 * A traceability certificate has to remain answerable years after the coffee
 * shipped, which is the whole point of it.
 */
import {
  alertNotifications,
  dataExports,
  events,
  sessions,
  verifications,
  webhookDeliveries,
} from "@roastery/db/schema";
import { and, isNotNull, lt, type SQL, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { WorkerDb } from "../db/db";
import type { OrgDb } from "../db/org-db";

const DAY_MS = 86_400_000;

/**
 * How long each thing is kept, and why that number.
 *
 * Quoted in the privacy policy, so changing one here means changing it there.
 */
export const RETENTION_DAYS = {
  /** Long enough for an integrator to notice a gap and ask us about it. */
  events: 90,
  /** Tied to `events`: a delivery is meaningless once its event is gone. */
  webhookDeliveries: 90,
  /** Two seasons, so "did we warn them last spring" is answerable. */
  alertNotifications: 180,
  /** The full-fidelity curve lives in object storage; this is the downsample. */
  roastSamples: 365,
} as const;

/** Rows per statement. Bounded so one call cannot hold a lock for minutes. */
const BATCH = 5000;

/**
 * Caps a delete at BATCH rows.
 *
 * Postgres has no LIMIT on DELETE, so the bound is a subquery on the primary
 * key. Without one, a tenant that has not been swept for a year deletes
 * millions of rows in a single statement and holds locks for the duration.
 * What is left over is taken by the next night's run.
 */
function limitedTo(idColumn: PgColumn, table: string, orgId: string): SQL {
  return sql`${idColumn} in (
    select id from ${sql.raw(table)} where org_id = ${orgId}::uuid limit ${BATCH}
  )`;
}

/**
 * `and()` is typed as possibly-undefined because it returns nothing when given
 * no conditions. Every call here passes several, so this asserts what the
 * types cannot see rather than each site pretending with a cast.
 */
function must(condition: SQL | undefined): SQL {
  if (!condition) throw new Error("Empty retention predicate");
  return condition;
}

export type RetentionResult = Record<string, number>;

/**
 * Deletes one organization's expired rows.
 *
 * Per-organization rather than one sweeping DELETE across the table: a
 * statement that touches every tenant's rows at once takes locks across the
 * whole table and blocks writes for everybody, which is a strange thing to do
 * in the name of housekeeping.
 */
export async function applyRetention(db: OrgDb): Promise<RetentionResult> {
  const now = Date.now();
  const removed: RetentionResult = {};

  const cutoff = (days: number) => new Date(now - days * DAY_MS);
  // Raw SQL fragments below take an ISO string with an explicit cast: a Date
  // interpolated into `sql`` ` outside a column comparison reaches the driver
  // unserialized.
  const cutoffIso = (days: number) => cutoff(days).toISOString();

  /**
   * An event goes only once its deliveries have settled.
   *
   * Deliveries cascade from the event, so deleting an event still waiting to
   * be delivered would drop a webhook a customer is owed — quietly, since the
   * queue message would then find nothing and ack.
   */
  removed.events = await db.delete(
    events,
    must(
      and(
        isNotNull(events.fannedOutAt),
        lt(events.occurredAt, cutoff(RETENTION_DAYS.events)),
        sql`not exists (
        select 1 from webhook_deliveries d
         where d.event_id = ${events.id} and d.status in ('pending', 'failed')
      )`,
        sql`${events.id} in (
        select id from events
         where org_id = ${db.orgId}::uuid
           and fanned_out_at is not null
           and occurred_at < ${cutoffIso(RETENTION_DAYS.events)}::timestamptz
         limit ${BATCH}
      )`,
      ),
    ),
  );

  removed.webhookDeliveries = await db.delete(
    webhookDeliveries,
    must(
      and(
        lt(webhookDeliveries.createdAt, cutoff(RETENTION_DAYS.webhookDeliveries)),
        limitedTo(webhookDeliveries.id, "webhook_deliveries", db.orgId),
      ),
    ),
  );

  removed.alertNotifications = await db.delete(
    alertNotifications,
    must(
      and(
        lt(alertNotifications.createdAt, cutoff(RETENTION_DAYS.alertNotifications)),
        limitedTo(alertNotifications.id, "alert_notifications", db.orgId),
      ),
    ),
  );

  /**
   * Samples go only when the complete curve is safely in object storage.
   *
   * Postgres holds a 1 Hz downsample for querying and R2 holds the real thing.
   * Deleting the downsample from a batch whose upload never completed would
   * destroy the only copy.
   */
  // unscoped-ok: roast_samples is TENANT_VIA — it has no tenant column, which
  // is exactly why the join to roast_batches carries the org predicate here.
  removed.roastSamples = await db.query(async (t) => {
    const rows = await t.execute<{ n: number }>(sql`
      delete from roast_samples s
       using roast_batches b
       where b.id = s.batch_id
         and b.org_id = ${db.orgId}::uuid
         and b.curve_object_key is not null
         and b.started_at < ${cutoffIso(RETENTION_DAYS.roastSamples)}::timestamptz
      returning 1 as n
    `);
    return [...rows].length;
  });

  // An export is a complete copy of the business's history behind a link. Once
  // it expires the row is worthless and the object is a liability.
  removed.dataExports = await db.delete(
    dataExports,
    must(and(isNotNull(dataExports.expiresAt), lt(dataExports.expiresAt, new Date(now)))),
  );

  return removed;
}

/**
 * Deletes what is not scoped to any organization.
 *
 * Expired sessions and verification tokens belong to users rather than to
 * tenants, so they are swept once for the whole deployment rather than per
 * organization.
 */
export async function applyGlobalRetention(db: WorkerDb): Promise<RetentionResult> {
  const now = new Date();
  const expiredSessions = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, now))
    .returning({ id: sessions.id });
  const expiredVerifications = await db
    .delete(verifications)
    .where(lt(verifications.expiresAt, now))
    .returning({ id: verifications.id });

  return {
    sessions: expiredSessions.length,
    verifications: expiredVerifications.length,
  };
}

/**
 * Drops espresso shot partitions older than the window.
 *
 * The reason `espresso_shots` is partitioned at all: the schema comment says
 * partitioning is "what makes retention a DROP TABLE", and until now nothing
 * dropped anything. Thirteen months so a full year plus the current month is
 * always queryable, and the hourly rollups outlive the raw shots.
 */
const KEEP_MONTHS = 13;

export async function dropExpiredShotPartitions(db: WorkerDb): Promise<string[]> {
  const now = new Date();
  const oldest = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - KEEP_MONTHS, 1));

  const rows = await db.execute<{ relname: string }>(sql`
    select c.relname
      from pg_inherits i
      join pg_class c on c.oid = i.inhrelid
      join pg_class p on p.oid = i.inhparent
     where p.relname = 'espresso_shots'
       and c.relname ~ '^espresso_shots_[0-9]{4}_[0-9]{2}$'
  `);

  const dropped: string[] = [];
  for (const row of rows) {
    const match = row.relname.match(/^espresso_shots_(\d{4})_(\d{2})$/);
    if (!match) continue;
    const month = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    if (month >= oldest) continue;

    // DETACH first, so the parent is not locked for the duration of the drop.
    await db.execute(sql.raw(`ALTER TABLE espresso_shots DETACH PARTITION ${row.relname}`));
    await db.execute(sql.raw(`DROP TABLE ${row.relname}`));
    dropped.push(row.relname);
  }

  if (dropped.length > 0) {
    console.log(JSON.stringify({ msg: "shot_partitions_dropped", partitions: dropped }));
  }
  return dropped;
}

/** Kept for the life of the account. See the header. */
export const NEVER_DELETED = ["audit_events"] as const;
