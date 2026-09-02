import { webhookDeliveries } from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import type { WorkerDb } from "../db/db";

/**
 * Records that a delivery reached the dead-letter queue.
 *
 * Kept out of the queue module so the DLQ handler does not have to import the
 * whole delivery engine — a dead-letter batch should be the cheapest possible
 * thing to process, since it runs when something is already wrong.
 */
export async function markDead(db: WorkerDb, deliveryId: string, reason: string): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({ status: "dead", lastError: reason, nextAttemptAt: null, updatedAt: new Date() })
    .where(eq(webhookDeliveries.id, deliveryId));
}
