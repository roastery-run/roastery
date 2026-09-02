/**
 * The transactional outbox.
 *
 * An event row is written in the SAME transaction as the change it describes.
 * That is the whole design, and the reason it is not "publish after commit":
 * between a commit and a queue send the Worker can die, the queue can be
 * unavailable, or the isolate can be evicted — and every one of those leaves a
 * customer whose lot moved but whose webhook never fired, with nothing in the
 * system that knows it is owed. Here the event either commits with the change
 * or neither happens.
 *
 * Getting the row OUT of the table is then a separate, retryable problem with
 * two independent solutions: an inline enqueue on the request path for
 * latency, and a cron sweeper for durability. Both are safe to run because the
 * delivery table is unique on (endpoint, event).
 */
import { auditEvents, events } from "@roastery/db/schema";
import type { EventType } from "@roastery/schemas";
import type { WorkerDb } from "../db/db";
import type { Actor } from "../db/org-db";

export type ChangeRecord = {
  /** Published event type, or null for a change with no external audience. */
  type: EventType | null;
  resourceType: string;
  resourceId: string;
  /** Audit verb. Defaults to the last segment of the event type. */
  action?: string;
  /**
   * What the receiver gets. Keep it to the identifying fields and what
   * changed — a webhook is a notification, not a replication feed, and a fat
   * payload becomes a compatibility burden the moment anyone parses it.
   */
  payload?: Record<string, unknown>;
  /** Extra context for the audit row only. Never leaves the system. */
  audit?: Record<string, unknown>;
};

export type EmittedEvent = { id: string; orgId: string; type: string };

/**
 * Records one change as both an audit row and (when it has a published type)
 * an outbox event.
 *
 * They are written together because they describe the same fact. Two call
 * sites would drift: someone adds an event and forgets the audit, or logs an
 * audit row for something no integrator can observe. The difference between
 * them is audience, not content — audit is internal and complete, events are
 * external and filtered by what each endpoint subscribed to.
 */
export async function recordChange(
  db: WorkerDb,
  orgId: string,
  actor: Actor,
  change: ChangeRecord,
): Promise<EmittedEvent | null> {
  const action = change.action ?? change.type?.split(".").pop() ?? "changed";

  await db.insert(auditEvents).values({
    orgId,
    actorId: actor.id,
    actorType: actor.type,
    action: `${change.resourceType}.${action}`,
    resourceType: change.resourceType,
    resourceId: change.resourceId,
    metadata: { ...change.payload, ...change.audit },
  });

  if (!change.type) return null;

  const [row] = await db
    .insert(events)
    .values({
      orgId,
      type: change.type,
      resourceType: change.resourceType,
      resourceId: change.resourceId,
      payload: change.payload ?? {},
      actorId: actor.id,
      actorType: actor.type,
    })
    .returning({ id: events.id });

  if (!row) throw new Error("Outbox insert returned no row");
  return { id: row.id, orgId, type: change.type };
}

/**
 * Does an endpoint's subscription match this event type?
 *
 * An empty subscription means everything, INCLUDING types added after the
 * endpoint was created. That is deliberate: the common case is an integrator
 * who wants the whole feed, and making them come back to opt into each new
 * type is how a webhook system quietly stops delivering.
 */
export function subscriptionMatches(subscriptions: string[], type: string): boolean {
  if (subscriptions.length === 0) return true;
  for (const s of subscriptions) {
    if (s === "*" || s === type) return true;
    if (s.endsWith(".*") && type.startsWith(s.slice(0, -1))) return true;
  }
  return false;
}
