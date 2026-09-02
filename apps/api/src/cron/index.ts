/**
 * Scheduled work.
 *
 * The governing rule: cron decides what work EXISTS and only enqueues it. A
 * scheduled handler has a single request's CPU budget and its failures are
 * silent, so anything that does the work inline will eventually time out on
 * the one organization large enough to matter, and nobody will find out.
 */
import type { Env } from "../env";
import { closeWorkerDb, createWorkerDb } from "../lib/db/db";
import { ensureShotPartitions } from "../lib/domain/shot-ingest";
import { findDueDeliveries, findPendingFanOut } from "../lib/events/webhook-delivery";
import { sendAlertDigests } from "./alerts";

export type CronPattern = string;

export async function handleScheduled(cron: CronPattern, env: Env): Promise<void> {
  switch (cron) {
    case "* * * * *":
      await sweepOutbox(env);
      break;
    case "0 4 * * *":
      await rollShotPartitions(env);
      break;
    case "0 7 * * *":
      await sendAlertDigests(env);
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
  const db = createWorkerDb(env);
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
  } finally {
    await closeWorkerDb(db);
  }
}

/**
 * Keeps the shot table's partition window ahead of real time.
 *
 * A shot arriving with no matching range lands in the default partition, which
 * works — data is never lost — but concentrates everything into one table and
 * defeats the point of partitioning. Creating months in advance means that
 * only ever happens to a bridge with a badly wrong clock.
 */
async function rollShotPartitions(env: Env): Promise<void> {
  const db = createWorkerDb(env);
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
  } finally {
    await closeWorkerDb(db);
  }
}
