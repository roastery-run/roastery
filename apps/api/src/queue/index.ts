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
import type { Env, EventQueueMessage, WebhookQueueMessage } from "../env";
import { closeWorkerDb, createWorkerDb } from "../lib/db/db";
import { attemptDelivery, fanOutEvent } from "../lib/events/webhook-delivery";

export async function handleEventQueue(
  batch: MessageBatch<EventQueueMessage>,
  env: Env,
): Promise<void> {
  const db = createWorkerDb(env);
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
  const db = createWorkerDb(env);
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
  const db = createWorkerDb(env);
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
