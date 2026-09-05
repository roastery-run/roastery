/**
 * Scheduled work.
 *
 * The governing rule: cron decides what work EXISTS and only enqueues it. A
 * scheduled handler has a single request's CPU budget and its failures are
 * silent, so anything that does the work inline will eventually time out on
 * the one organization large enough to matter, and nobody will find out.
 */
import { organizations } from "@roastery/db/schema";
import type { Env } from "../env";
import { recordMetric } from "../lib/api/metrics";
import { closeWorkerDb, createOwnedWorkerDb } from "../lib/db/db";
import { ensureShotPartitions } from "../lib/domain/shot-ingest";
import { findDueDeliveries, findPendingFanOut } from "../lib/events/webhook-delivery";
import { sendAlertDigests } from "./alerts";
import { checkOpsThresholds } from "./ops";

export type CronPattern = string;

export async function handleScheduled(cron: CronPattern, env: Env): Promise<void> {
  switch (cron) {
    case "* * * * *":
      await sweepOutbox(env);
      break;
    case "30 3 * * *":
      await enqueueReconciliation(env);
      break;
    case "0 4 * * *":
      await rollShotPartitions(env);
      break;
    case "0 7 * * *":
      await sendAlertDigests(env);
      break;
    case "*/5 * * * *":
      await checkOpsThresholds(env);
      break;
    default:
      console.warn(JSON.stringify({ msg: "unhandled_cron", cron }));
  }
}

/**
 * The durability half of the outbox.
 *
 * The request path enqueues an event inline for latency, but that send happens
 * after the commit and can be lost — the isolate is evicted, the queue is
 * briefly unavailable, the Worker is killed mid-`waitUntil`. This sweep is
 * what makes that survivable: any event still unfanned after its grace period
 * is picked up here, so the worst case of a lost enqueue is a minute of delay
 * rather than a webhook that never arrives.
 *
 * It also re-drives deliveries whose retry is due but whose queue message went
 * missing, for the same reason.
 */
async function sweepOutbox(env: Env): Promise<void> {
  const db = createOwnedWorkerDb(env);
  try {
    const eventIds = await findPendingFanOut(db, { olderThanSeconds: 30, limit: 200 });
    if (eventIds.length > 0 && env.EVENT_QUEUE) {
      await env.EVENT_QUEUE.sendBatch(eventIds.map((eventId) => ({ body: { eventId } })));
    }

    const deliveryIds = await findDueDeliveries(db, 200);
    if (deliveryIds.length > 0 && env.WEBHOOK_QUEUE) {
      await env.WEBHOOK_QUEUE.sendBatch(
        deliveryIds.map((deliveryId) => ({ body: { deliveryId, attempt: 0 } })),
      );
    }

    if (eventIds.length > 0 || deliveryIds.length > 0) {
      console.log(
        JSON.stringify({
          msg: "outbox_swept",
          events: eventIds.length,
          deliveries: deliveryIds.length,
        }),
      );
    }
  } catch (err) {
    // The sweeper IS the durability half of the outbox. If it is failing, the
    // guarantee that a committed change eventually fans out is not holding —
    // and an unhandled throw in a scheduled handler is invisible, which is the
    // worst possible way for that to be true.
    console.error(
      JSON.stringify({
        msg: "outbox_sweep_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    recordMetric(env, { kind: "maintenance_failed", job: "outbox_sweep" });
  } finally {
    await closeWorkerDb(db);
  }
}

/**
 * Asks every organization to check its own books.
 *
 * Enqueue-only, per the rule at the top of this file: the scan is three
 * aggregate queries per tenant, which is fine once and not fine four hundred
 * times inside one scheduled handler. Running it here would time out on the
 * largest tenant and report nothing.
 *
 * Runs at 03:30 so that anything it finds is already recorded when the 07:00
 * digest goes out, rather than waiting a further day to be told.
 */
async function enqueueReconciliation(env: Env): Promise<void> {
  if (!env.MAINTENANCE_QUEUE) return;
  const queue = env.MAINTENANCE_QUEUE;
  const db = createOwnedWorkerDb(env);
  try {
    const orgs = await db.select({ id: organizations.id }).from(organizations);
    for (let i = 0; i < orgs.length; i += BATCH) {
      await queue.sendBatch(
        orgs
          .slice(i, i + BATCH)
          .map((org) => ({ body: { job: "reconcile" as const, orgId: org.id } })),
      );
    }
    console.log(JSON.stringify({ msg: "reconciliation_enqueued", orgs: orgs.length }));
  } finally {
    await closeWorkerDb(db);
  }
}

/** sendBatch accepts at most 100 messages. */
const BATCH = 100;

/**
 * Keeps the shot table's partition window ahead of real time.
 *
 * A shot arriving with no matching range lands in the default partition, which
 * works — data is never lost — but concentrates everything into one table and
 * defeats the point of partitioning. Creating months in advance means that
 * only ever happens to a bridge with a badly wrong clock.
 */
async function rollShotPartitions(env: Env): Promise<void> {
  const db = createOwnedWorkerDb(env);
  try {
    const created = await ensureShotPartitions(db, 3);
    console.log(JSON.stringify({ msg: "shot_partitions_ensured", partitions: created }));
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "shot_partition_maintenance_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    recordMetric(env, { kind: "maintenance_failed", job: "shot_partitions" });
  } finally {
    await closeWorkerDb(db);
  }
}
