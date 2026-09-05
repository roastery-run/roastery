import {
  alertNotifications,
  events,
  webhookDeliveries,
  webhookEndpoints,
} from "@roastery/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkerDb } from "../src/lib/db/db";
import type { OrgDb } from "../src/lib/db/org-db";
import { applyRetention, RETENTION_DAYS } from "../src/lib/domain/retention";
import { connect, createTestOrg, dropTestOrg, hasTestDb, orgDb } from "./helpers/db";

/**
 * Deleting what no longer needs keeping — and, more importantly, not deleting
 * anything else.
 *
 * Nothing in the system deleted anything before this. The two tables that grow
 * fastest are `events` and `webhook_deliveries`, because one event with five
 * subscribers is six rows, and on a size-limited database the first symptom is
 * writes failing everywhere for reasons unrelated to what anyone was doing.
 *
 * The risk in fixing that is deleting something that was still needed, so most
 * of what follows checks the exceptions rather than the deletions.
 */
const DAY_MS = 86_400_000;

describe.skipIf(!hasTestDb)("retention", () => {
  let db: WorkerDb;
  let close: () => Promise<void>;
  const orgs: string[] = [];
  let orgId: string;
  let scoped: OrgDb;

  beforeAll(async () => {
    ({ db, close } = connect());
  });

  beforeEach(async () => {
    orgId = await createTestOrg(db);
    orgs.push(orgId);
    scoped = orgDb(db, orgId);
  });

  afterAll(async () => {
    for (const id of orgs) await dropTestOrg(db, id);
    await close?.();
  });

  const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

  async function seedEvent(opts: { occurredAt: Date; fannedOut: boolean }) {
    const [row] = await scoped.insert(events, {
      type: "catalog.location.created",
      resourceType: "location",
      resourceId: crypto.randomUUID(),
      payload: {},
      occurredAt: opts.occurredAt,
      fannedOutAt: opts.fannedOut ? opts.occurredAt : null,
      actorType: "system",
    });
    if (!row) throw new Error("no event");
    return row.id;
  }

  async function countEvents() {
    const rows = await scoped.query(async (t, scope) =>
      t.select({ id: events.id }).from(events).where(scope(events)),
    );
    return rows.length;
  }

  it("removes fanned-out events past the window", async () => {
    await seedEvent({ occurredAt: daysAgo(RETENTION_DAYS.events + 10), fannedOut: true });
    expect(await countEvents()).toBe(1);

    const removed = await applyRetention(scoped);
    expect(removed.events).toBe(1);
    expect(await countEvents()).toBe(0);
  });

  it("keeps a recent event", async () => {
    await seedEvent({ occurredAt: daysAgo(1), fannedOut: true });
    await applyRetention(scoped);
    expect(await countEvents()).toBe(1);
  });

  it("keeps an old event that never fanned out", async () => {
    // The sweeper is still responsible for it. Deleting it would drop a
    // webhook nobody has received, silently, since the outbox is the only
    // record that it is owed.
    await seedEvent({ occurredAt: daysAgo(RETENTION_DAYS.events + 10), fannedOut: false });
    await applyRetention(scoped);
    expect(await countEvents()).toBe(1);
  });

  it("keeps an old event whose delivery is still pending", async () => {
    const eventId = await seedEvent({
      occurredAt: daysAgo(RETENTION_DAYS.events + 10),
      fannedOut: true,
    });
    const [endpoint] = await scoped.insert(webhookEndpoints, {
      url: "https://hooks.example.com/x",
      secretCiphertext: "x",
      secretIv: "x",
      eventTypes: [],
    });
    if (!endpoint) throw new Error("no endpoint");
    await scoped.insert(webhookDeliveries, {
      endpointId: endpoint.id,
      eventId,
      eventType: "catalog.location.created",
      status: "pending",
      nextAttemptAt: new Date(),
    });

    await applyRetention(scoped);

    // Deliveries cascade from the event, so removing it here would destroy a
    // delivery the customer is still owed.
    expect(await countEvents()).toBe(1);
  });

  it("removes old alert notifications and keeps recent ones", async () => {
    const insert = (createdAt: Date, subjectId: string) =>
      scoped.query(async (t) =>
        t.insert(alertNotifications).values({
          orgId,
          ruleId: "inventory.green.below_minimum",
          subjectId,
          digestDate: createdAt.toISOString().slice(0, 10),
          severity: "warning",
          createdAt,
        }),
      );
    await insert(daysAgo(RETENTION_DAYS.alertNotifications + 10), crypto.randomUUID());
    await insert(daysAgo(2), crypto.randomUUID());

    const removed = await applyRetention(scoped);
    expect(removed.alertNotifications).toBe(1);

    const left = await scoped.query(async (t, scope) =>
      t.select().from(alertNotifications).where(scope(alertNotifications)),
    );
    expect(left).toHaveLength(1);
  });

  it("never touches the audit log", async () => {
    // The answer to "who made themselves an owner". A retention window on it is
    // a window in which that question stops having an answer.
    await scoped.emit({
      type: null,
      resourceType: "org_member",
      resourceId: crypto.randomUUID(),
      action: "role_changed",
    });
    await db.execute(
      sql`update audit_events set created_at = ${daysAgo(3650).toISOString()}::timestamptz where org_id = ${orgId}::uuid`,
    );

    await applyRetention(scoped);

    const rows = await db.execute<{ n: string }>(
      sql`select count(*)::text as n from audit_events where org_id = ${orgId}::uuid`,
    );
    expect(Number([...rows][0]?.n)).toBe(1);
  });

  it("leaves another organization's expired rows alone", async () => {
    // Retention runs per tenant, so a sweep for one must not reach another's
    // rows even though they are equally expired.
    const otherId = await createTestOrg(db);
    orgs.push(otherId);
    const other = orgDb(db, otherId);
    await other.insert(events, {
      type: "catalog.location.created",
      resourceType: "location",
      resourceId: crypto.randomUUID(),
      payload: {},
      occurredAt: daysAgo(RETENTION_DAYS.events + 10),
      fannedOutAt: daysAgo(RETENTION_DAYS.events + 10),
      actorType: "system",
    });

    await applyRetention(scoped);

    const left = await other.query(async (t, scope) =>
      t
        .select({ id: events.id })
        .from(events)
        .where(and(scope(events), eq(events.orgId, otherId))),
    );
    expect(left).toHaveLength(1);
  });
});
