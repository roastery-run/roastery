/**
 * Getting an outbox event to somebody else's server.
 *
 * Two stages, deliberately separate. Fan-out decides WHO should receive an
 * event and creates one delivery row per endpoint; delivery signs and POSTs
 * one of those rows. Splitting them means a slow or broken endpoint delays
 * only its own deliveries, and a fan-out retry cannot re-POST to endpoints
 * that already succeeded.
 */
import { events, webhookDeliveries, webhookEndpoints } from "@roastery/db/schema";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Env } from "../../env";
import type { WorkerDb } from "../db/db";
import { subscriptionMatches } from "./events";
import { openSecret, signatureHeader } from "./webhook-crypto";

/**
 * The retry schedule: ~8 hours of coverage.
 *
 * Front-loaded because most failures are transient — a deploy, a restart, a
 * momentary timeout — and back-loaded because the ones that are not need to
 * survive somebody's night. Past this we stop: an endpoint that has been
 * unreachable for eight hours needs a human, not a ninth attempt.
 */
export const RETRY_DELAYS_SECONDS = [10, 60, 300, 1800, 7200, 21600];
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;

/** Consecutive failures before an endpoint is switched off and its owners told. */
export const AUTO_DISABLE_THRESHOLD = 20;

const REQUEST_TIMEOUT_MS = 10_000;

export type DeliveryOutcome =
  | { kind: "delivered"; statusCode: number; durationMs: number }
  | {
      kind: "retry";
      statusCode: number | null;
      error: string;
      delaySeconds: number;
      durationMs: number;
    }
  | { kind: "dead"; statusCode: number | null; error: string; durationMs: number }
  | { kind: "disable_endpoint"; statusCode: number; error: string; durationMs: number };

/**
 * What to do with a response. Pure, so the policy is testable without a server.
 *
 * The distinctions here are the difference between a webhook system that is
 * useful and one that is a nuisance:
 *
 * - 2xx is success. 3xx is not — a redirect on a POST is a misconfiguration,
 *   and following it would deliver a signed payload to a host the customer
 *   never registered.
 * - 410 Gone is the receiver explicitly saying "stop", so we stop immediately
 *   rather than spending eight hours proving they meant it.
 * - Other 4xx (except 408 and 429) means the request is wrong, and it will be
 *   just as wrong in six hours. Retrying a 404 from a deleted route for eight
 *   hours is pure noise; one attempt and it is dead.
 * - 408, 429 and every 5xx are transient by definition, and get the schedule.
 */
export function classifyResponse(
  statusCode: number | null,
  attempt: number,
  networkError: string | null,
  durationMs: number,
): DeliveryOutcome {
  const nextDelay = RETRY_DELAYS_SECONDS[attempt];

  if (statusCode === null) {
    // A connection failure or timeout: nothing was learned about the receiver
    // except that it did not answer, which is exactly what retries are for.
    return nextDelay === undefined
      ? { kind: "dead", statusCode: null, error: networkError ?? "No response", durationMs }
      : {
          kind: "retry",
          statusCode: null,
          error: networkError ?? "No response",
          delaySeconds: nextDelay,
          durationMs,
        };
  }

  if (statusCode >= 200 && statusCode < 300) {
    return { kind: "delivered", statusCode, durationMs };
  }

  if (statusCode >= 300 && statusCode < 400) {
    // A redirect is not success and is not followed: following it would
    // deliver a signed payload to a host the customer never registered. It is
    // also not transient — it is a misconfigured URL, and six hours of retries
    // will not fix a wrong URL. The endpoint needs editing.
    return {
      kind: "dead",
      statusCode,
      error: `Endpoint redirected (${statusCode}); register the final URL instead`,
      durationMs,
    };
  }

  if (statusCode === 410) {
    return {
      kind: "disable_endpoint",
      statusCode,
      error: "Endpoint returned 410 Gone",
      durationMs,
    };
  }

  const transient = statusCode === 408 || statusCode === 429 || statusCode >= 500;
  if (!transient) {
    return {
      kind: "dead",
      statusCode,
      error: `Endpoint returned ${statusCode}; not retrying a client error`,
      durationMs,
    };
  }

  if (nextDelay === undefined) {
    return {
      kind: "dead",
      statusCode,
      error: `Endpoint returned ${statusCode}; retry schedule exhausted`,
      durationMs,
    };
  }
  return {
    kind: "retry",
    statusCode,
    error: `Endpoint returned ${statusCode}`,
    delaySeconds: nextDelay,
    durationMs,
  };
}

/* --------------------------------------------------------------- fan-out */

export type FanOutResult = { eventId: string; deliveryIds: string[] };

/**
 * Creates the delivery rows for one event.
 *
 * Safe to run more than once for the same event. The unique index on
 * (endpoint, event) turns a second fan-out into a no-op rather than a
 * duplicate POST, which is what lets the inline enqueue and the cron sweeper
 * both cover the same event without coordinating.
 */
export async function fanOutEvent(db: WorkerDb, eventId: string): Promise<FanOutResult> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
  if (!event) return { eventId, deliveryIds: [] };

  const endpoints = await db
    .select()
    .from(webhookEndpoints)
    .where(and(eq(webhookEndpoints.orgId, event.orgId), eq(webhookEndpoints.status, "active")));

  const matching = endpoints.filter((e) => subscriptionMatches(e.eventTypes, event.type));

  const deliveryIds: string[] = [];
  if (matching.length > 0) {
    const inserted = await db
      .insert(webhookDeliveries)
      .values(
        matching.map((e) => ({
          orgId: event.orgId,
          endpointId: e.id,
          eventId: event.id,
          eventType: event.type,
          status: "pending" as const,
          nextAttemptAt: new Date(),
        })),
      )
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.id });
    deliveryIds.push(...inserted.map((r) => r.id));
  }

  // Marked fanned out even when nothing matched: the question this flag
  // answers is "has this event been considered", not "was it delivered".
  // Leaving it null would make the sweeper reconsider it every minute forever.
  await db.update(events).set({ fannedOutAt: new Date() }).where(eq(events.id, event.id));

  return { eventId, deliveryIds };
}

/**
 * Events the sweeper should pick up.
 *
 * The age floor is what keeps the sweeper out of the request path's way: an
 * event committed two seconds ago is almost certainly already enqueued inline,
 * and fanning it out again would be harmless but pointless work every minute.
 */
export async function findPendingFanOut(
  db: WorkerDb,
  { olderThanSeconds = 30, limit = 200 } = {},
): Promise<string[]> {
  const cutoff = new Date(Date.now() - olderThanSeconds * 1000);
  const rows = await db
    .select({ id: events.id })
    .from(events)
    .where(and(isNull(events.fannedOutAt), lt(events.occurredAt, cutoff)))
    .orderBy(events.occurredAt)
    .limit(limit);
  return rows.map((r) => r.id);
}

/* -------------------------------------------------------------- delivery */

export type DeliveryBody = {
  id: string;
  type: string;
  sequence: number;
  occurredAt: string;
  organizationId: string;
  data: { resourceType: string; resourceId: string; attributes: unknown };
};

/**
 * Signs and POSTs one delivery, then records what happened.
 *
 * Returns the outcome so the queue consumer can decide whether to ask the
 * queue to redeliver. The database is updated here rather than by the caller
 * because a delivery whose attempt is recorded only on the happy path is a
 * delivery nobody can debug.
 */
export async function attemptDelivery(
  db: WorkerDb,
  env: Env,
  deliveryId: string,
): Promise<DeliveryOutcome | null> {
  const [row] = await db
    .select({
      delivery: webhookDeliveries,
      endpoint: webhookEndpoints,
      event: events,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .innerJoin(events, eq(events.id, webhookDeliveries.eventId))
    .where(eq(webhookDeliveries.id, deliveryId))
    .limit(1);

  if (!row) return null;
  const { delivery, endpoint, event } = row;

  // Already settled: a queue redelivery of a message we finished with must not
  // POST a second time.
  if (delivery.status === "succeeded" || delivery.status === "dead") return null;

  // An endpoint disabled between fan-out and delivery should not be POSTed to.
  if (endpoint.status !== "active") {
    await db
      .update(webhookDeliveries)
      .set({
        status: "dead",
        lastError: `Endpoint is ${endpoint.status}`,
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, deliveryId));
    return { kind: "dead", statusCode: null, error: "Endpoint is not active", durationMs: 0 };
  }

  const body: DeliveryBody = {
    id: event.id,
    type: event.type,
    sequence: Number(event.sequence),
    occurredAt: event.occurredAt.toISOString(),
    organizationId: event.orgId,
    data: {
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      attributes: event.payload,
    },
  };
  const serialized = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);

  const secrets = [
    await openSecret(env.WEBHOOK_KEK, {
      ciphertext: endpoint.secretCiphertext,
      iv: endpoint.secretIv,
    }),
  ];
  // The previous secret is still signed with until its overlap expires, so an
  // integrator can deploy the new one whenever they get to it.
  if (
    endpoint.previousSecretCiphertext &&
    endpoint.previousSecretIv &&
    endpoint.previousSecretExpiresAt &&
    endpoint.previousSecretExpiresAt.getTime() > Date.now()
  ) {
    secrets.push(
      await openSecret(env.WEBHOOK_KEK, {
        ciphertext: endpoint.previousSecretCiphertext,
        iv: endpoint.previousSecretIv,
      }),
    );
  }

  const signature = await signatureHeader(secrets, timestamp, serialized);
  const attempt = delivery.attempt;
  const startedAt = Date.now();

  let statusCode: number | null = null;
  let networkError: string | null = null;
  try {
    const response = await fetch(endpoint.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "Roastery-Webhooks/1.0",
        "roastery-event-id": event.id,
        "roastery-event-type": event.type,
        "roastery-delivery-id": delivery.id,
        "roastery-timestamp": String(timestamp),
        "roastery-signature": signature,
        // Tells a receiver this is a repeat without them having to remember
        // the event id, which is what makes idempotency cheap on their side.
        "roastery-attempt": String(attempt + 1),
      },
      body: serialized,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    statusCode = response.status;
    // The body is not read. We only need the status, and a receiver streaming
    // a large response would otherwise hold a Worker invocation open.
  } catch (err) {
    networkError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  }

  const durationMs = Date.now() - startedAt;
  const outcome = classifyResponse(statusCode, attempt, networkError, durationMs);
  await applyOutcome(db, delivery.id, endpoint.id, attempt, outcome);
  return outcome;
}

async function applyOutcome(
  db: WorkerDb,
  deliveryId: string,
  endpointId: string,
  attempt: number,
  outcome: DeliveryOutcome,
): Promise<void> {
  const now = new Date();

  if (outcome.kind === "delivered") {
    await db
      .update(webhookDeliveries)
      .set({
        status: "succeeded",
        attempt: attempt + 1,
        lastStatusCode: outcome.statusCode,
        lastError: null,
        lastDurationMs: outcome.durationMs,
        deliveredAt: now,
        nextAttemptAt: null,
        updatedAt: now,
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    // A success resets the counter, so twenty failures means twenty in a ROW.
    // Counting cumulative failures would eventually disable every endpoint
    // that has ever had a bad afternoon.
    await db
      .update(webhookEndpoints)
      .set({ consecutiveFailures: 0, lastSuccessAt: now, updatedAt: now })
      .where(eq(webhookEndpoints.id, endpointId));
    return;
  }

  const isFinal = outcome.kind !== "retry";
  await db
    .update(webhookDeliveries)
    .set({
      status: isFinal ? "dead" : "failed",
      attempt: attempt + 1,
      lastStatusCode: outcome.statusCode,
      lastError: outcome.error.slice(0, 1000),
      lastDurationMs: outcome.durationMs,
      nextAttemptAt:
        outcome.kind === "retry" ? new Date(Date.now() + outcome.delaySeconds * 1000) : null,
      updatedAt: now,
    })
    .where(eq(webhookDeliveries.id, deliveryId));

  if (outcome.kind === "disable_endpoint") {
    await db
      .update(webhookEndpoints)
      .set({
        status: "auto_disabled",
        disabledAt: now,
        disabledReason: outcome.error,
        lastFailureAt: now,
        updatedAt: now,
      })
      .where(eq(webhookEndpoints.id, endpointId));
    return;
  }

  const [endpoint] = await db
    .update(webhookEndpoints)
    .set({
      consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1`,
      lastFailureAt: now,
      updatedAt: now,
    })
    .where(eq(webhookEndpoints.id, endpointId))
    .returning({ failures: webhookEndpoints.consecutiveFailures });

  if (endpoint && endpoint.failures >= AUTO_DISABLE_THRESHOLD) {
    await db
      .update(webhookEndpoints)
      .set({
        status: "auto_disabled",
        disabledAt: now,
        disabledReason: `${endpoint.failures} consecutive delivery failures`,
        updatedAt: now,
      })
      .where(eq(webhookEndpoints.id, endpointId));
  }
}

/** Deliveries whose retry is due. The safety net if a queue message is lost. */
export async function findDueDeliveries(db: WorkerDb, limit = 200): Promise<string[]> {
  const rows = await db
    .select({ id: webhookDeliveries.id })
    .from(webhookDeliveries)
    .where(
      and(
        inArray(webhookDeliveries.status, ["pending", "failed"]),
        lt(webhookDeliveries.nextAttemptAt, new Date()),
      ),
    )
    .orderBy(webhookDeliveries.nextAttemptAt)
    .limit(limit);
  return rows.map((r) => r.id);
}
