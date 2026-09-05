/**
 * Queue consumers.
 *
 * Webhook delivery is a queue and explicitly not a Workflow. A Workflow
 * instance per delivery would be orders of magnitude too heavy for something
 * that is one HTTP request, and Queues already provide exactly what delivery
 * needs — per-message retry with a delay we control, and a dead-letter queue
 * for what never succeeds.
 */
import type { MessageBatch } from "@cloudflare/workers-types";
import type { CafeSiteDO, LiveShot } from "../durable-objects/cafe-site";
import type {
  Env,
  EventQueueMessage,
  MaintenanceQueueMessage,
  ReportQueueMessage,
  ShotQueueMessage,
  WebhookQueueMessage,
} from "../env";
import { closeWorkerDb, createOwnedWorkerDb } from "../lib/db/db";
import { withOrgDb } from "../lib/db/org-db";
import { reconcileOrg } from "../lib/domain/reconciliation";
import {
  type IncomingShot,
  prepareShots,
  refreshRollups,
  touchedHours,
  writeShots,
} from "../lib/domain/shot-ingest";
import { attemptDelivery, fanOutEvent } from "../lib/events/webhook-delivery";
import { runReport } from "../lib/reporting/run";

export async function handleEventQueue(
  batch: MessageBatch<EventQueueMessage>,
  env: Env,
): Promise<void> {
  const db = createOwnedWorkerDb(env);
  try {
    for (const message of batch.messages) {
      try {
        const { deliveryIds } = await fanOutEvent(db, message.body.eventId);
        if (deliveryIds.length > 0 && env.WEBHOOK_QUEUE) {
          await env.WEBHOOK_QUEUE.sendBatch(
            deliveryIds.map((deliveryId) => ({ body: { deliveryId, attempt: 0 } })),
          );
        }
        message.ack();
      } catch (err) {
        console.error(
          JSON.stringify({
            msg: "event_fanout_failed",
            eventId: message.body.eventId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        // Fan-out is idempotent, so redelivery is safe and is the right answer
        // for a transient database failure.
        message.retry();
      }
    }
  } finally {
    // A leaked connection in a consumer exhausts the Hyperdrive pool far
    // faster than one in a request, because nothing else bounds the batch.
    await closeWorkerDb(db);
  }
}

export async function handleWebhookQueue(
  batch: MessageBatch<WebhookQueueMessage>,
  env: Env,
): Promise<void> {
  const db = createOwnedWorkerDb(env);
  try {
    for (const message of batch.messages) {
      const { deliveryId } = message.body;
      try {
        const outcome = await attemptDelivery(db, env, deliveryId);

        // null means the delivery was already settled, or the row is gone.
        // Either way there is nothing left to do with this message.
        if (outcome?.kind !== "retry") {
          message.ack();
          continue;
        }

        // The delay comes from OUR schedule, not the queue's default backoff,
        // so the documented retry timings are the ones that actually happen.
        message.retry({ delaySeconds: outcome.delaySeconds });
      } catch (err) {
        console.error(
          JSON.stringify({
            msg: "webhook_delivery_failed",
            deliveryId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        message.retry({ delaySeconds: 60 });
      }
    }
  } finally {
    await closeWorkerDb(db);
  }
}

/**
 * Scheduled work, one organization per message.
 *
 * The cron that feeds this only lists organizations and enqueues; the work
 * happens here so that one large tenant cannot exhaust a scheduled handler's
 * budget on behalf of everyone else, and so a failure retries for that tenant
 * alone rather than aborting the run.
 */
export async function handleMaintenanceQueue(
  batch: MessageBatch<MaintenanceQueueMessage>,
  env: Env,
): Promise<void> {
  const db = createOwnedWorkerDb(env);
  try {
    for (const message of batch.messages) {
      const { job, orgId } = message.body;
      try {
        if (job === "reconcile") {
          const { found, recorded } = await withOrgDb(db, orgId, (odb) => reconcileOrg(odb));
          // Logged even at zero: "the job ran and found nothing" and "the job
          // did not run" have to be distinguishable, or a silently broken
          // reconciliation looks exactly like a healthy ledger.
          console.log(JSON.stringify({ msg: "reconciled", orgId, found, recorded }));
        }
        message.ack();
      } catch (err) {
        console.error(
          JSON.stringify({
            msg: "maintenance_failed",
            job,
            orgId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        message.retry();
      }
    }
  } finally {
    await closeWorkerDb(db);
  }
}

/**
 * The dead-letter queues.
 *
 * A DLQ that only logs is a DLQ nobody looks at, so this records the terminal
 * state on the delivery row itself — the deliveries screen is where somebody
 * debugging a broken integration is already looking.
 */
export async function handleDeadLetterBatch(
  batch: MessageBatch<EventQueueMessage | WebhookQueueMessage>,
  env: Env,
): Promise<void> {
  const db = createOwnedWorkerDb(env);
  try {
    for (const message of batch.messages) {
      const body = message.body as Partial<EventQueueMessage & WebhookQueueMessage>;
      console.error(
        JSON.stringify({
          msg: "dead_letter",
          queue: batch.queue,
          eventId: body.eventId,
          deliveryId: body.deliveryId,
        }),
      );
      if (body.deliveryId) {
        const { markDead } = await import("../lib/events/webhook-dead-letter");
        await markDead(db, body.deliveryId, `Dead-lettered from ${batch.queue}`);
      }
      message.ack();
    }
  } finally {
    await closeWorkerDb(db);
  }
}

/**
 * Espresso shots: one multi-row upsert per batch, then the live view.
 *
 * The database write comes FIRST. The live bar is a view, so showing a shot
 * that failed to persist would put a number on a manager's screen that is not
 * in any report — which is worse than showing it a second late.
 */
export async function handleShotQueue(
  batch: MessageBatch<ShotQueueMessage>,
  env: Env,
): Promise<void> {
  const db = createOwnedWorkerDb(env);
  try {
    // Grouped by site so a chain posting from twelve bars at once produces one
    // upsert and one live-view call per site, not one per message.
    const bySite = new Map<string, { orgId: string; siteId: string; shots: IncomingShot[] }>();
    for (const message of batch.messages) {
      const { orgId, siteId, machineId, shots } = message.body;
      const key = `${orgId}:${siteId}`;
      const entry = bySite.get(key) ?? { orgId, siteId, shots: [] };
      for (const shot of shots as IncomingShot[]) {
        // The bridge is authenticated for one machine; trusting a machineId in
        // the body would let a compromised bar write shots for another site's
        // equipment.
        entry.shots.push({ ...shot, machineId });
      }
      bySite.set(key, entry);
    }

    for (const { orgId, siteId, shots } of bySite.values()) {
      const prepared = prepareShots(orgId, siteId, shots);
      if (!prepared.length) continue;

      const result = await writeShots(db, prepared);
      await refreshRollups(db, orgId, touchedHours(prepared));

      const stub = env.CAFE_SITE.get(
        env.CAFE_SITE.idFromName(`${orgId}:${siteId}`),
      ) as unknown as CafeSiteDO;

      const live: LiveShot[] = prepared.map((s) => ({
        externalId: s.externalId,
        machineId: s.machineId,
        groupNumber: s.groupNumber,
        pulledAt: s.pulledAt.getTime(),
        doseG: s.doseG === null ? null : Number.parseFloat(s.doseG),
        yieldG: s.yieldG === null ? null : Number.parseFloat(s.yieldG),
        durationS: s.durationS === null ? null : Number.parseFloat(s.durationS),
        ratio: s.ratio === null ? null : Number.parseFloat(s.ratio),
        verdict: s.verdict,
      }));

      const { anomalies } = await stub.record({ orgId, siteId, shots: live });

      if (result.duplicates > 0) {
        console.log(
          JSON.stringify({
            msg: "shots_deduplicated",
            siteId,
            received: result.received,
            inserted: result.inserted,
            duplicates: result.duplicates,
          }),
        );
      }
      for (const anomaly of anomalies) {
        console.warn(JSON.stringify({ msg: "cafe_anomaly", orgId, siteId, ...anomaly }));
      }
    }

    for (const message of batch.messages) message.ack();
  } catch (err) {
    console.error(
      JSON.stringify({
        msg: "shot_ingest_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    // Safe to redeliver: the write is an upsert keyed on the bridge's own shot
    // id, so a retry that partially succeeded the first time inserts nothing.
    for (const message of batch.messages) message.retry({ delaySeconds: 10 });
  } finally {
    await closeWorkerDb(db);
  }
}

/** Report rendering. See lib/reporting/run.ts for why this is not a waitUntil. */
export async function handleReportQueue(
  batch: MessageBatch<ReportQueueMessage>,
  env: Env,
): Promise<void> {
  const db = createOwnedWorkerDb(env);
  try {
    for (const message of batch.messages) {
      try {
        await runReport(db, env, message.body.orgId, message.body.reportId);
        message.ack();
      } catch (err) {
        console.error(
          JSON.stringify({
            msg: "report_render_failed",
            reportId: message.body.reportId,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
        // The failure is already recorded on the report row, so a retry that
        // also fails leaves the user with an explanation either way.
        message.retry({ delaySeconds: 30 });
      }
    }
  } finally {
    await closeWorkerDb(db);
  }
}
