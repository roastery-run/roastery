import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { events, webhookDeliveries, webhookEndpoints } from "@roastery/db/schema";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import type { WorkerDb } from "../src/lib/db/db";
import type { OrgDb } from "../src/lib/db/org-db";
import { generateSecret, sealSecret } from "../src/lib/events/webhook-crypto";
import {
  attemptDelivery,
  fanOutEvent,
  findDueDeliveries,
} from "../src/lib/events/webhook-delivery";
import { testEnv } from "./helpers/app";
import { connect, createTestOrg, dropTestOrg, hasTestDb, orgDb } from "./helpers/db";

/**
 * Webhook delivery, against servers that actually answer.
 *
 * This existed as `scripts/verify-webhooks.mjs` — a thorough harness that
 * needed a running Worker, a database and four hand-started receivers, and so
 * ran when somebody remembered. Everything it covered was therefore unverified
 * in CI: signing, retry classification, the 410 rule, auto-disable, the
 * recovery reset, and the sweeper.
 *
 * The signature is verified here the way an integrator's code would, written
 * from the documented rule rather than by calling our own helper. Checking a
 * signature with the function that produced it proves only that the function
 * is consistent with itself; if the documentation is wrong, this is what
 * catches it.
 */

type Behaviour = "ok" | "server-error" | "gone" | "flaky";

type Receiver = {
  url: string;
  server: Server;
  received: { body: string; headers: Record<string, string> }[];
  /** Flips a flaky receiver from failing to succeeding. */
  healthy: boolean;
};

async function startReceiver(behaviour: Behaviour): Promise<Receiver> {
  const state: Receiver = {
    url: "",
    server: createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        state.received.push({
          body,
          headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)])),
        });
        if (behaviour === "gone") return res.writeHead(410).end();
        if (behaviour === "server-error") return res.writeHead(500).end();
        if (behaviour === "flaky" && !state.healthy) return res.writeHead(503).end();
        res.writeHead(200).end();
      });
    }),
    received: [],
    healthy: behaviour !== "flaky",
  };

  await new Promise<void>((resolve) => state.server.listen(0, "127.0.0.1", resolve));
  const { port } = state.server.address() as AddressInfo;
  state.url = `http://127.0.0.1:${port}/hook`;
  return state;
}

/** The verification an integrator writes, from the documented rule. */
async function verifySignature(
  secret: string,
  header: string,
  timestamp: string,
  rawBody: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return header.split(",").some((part) => part.trim() === `v1=${expected}`);
}

describe.skipIf(!hasTestDb)("webhook delivery", () => {
  let db: WorkerDb;
  let close: () => Promise<void>;
  let orgId: string;
  let scoped: OrgDb;
  const receivers: Receiver[] = [];
  let env: Env;

  beforeAll(async () => {
    ({ db, close } = connect());
    orgId = await createTestOrg(db);
    scoped = orgDb(db, orgId);
    // A real KEK: endpoint secrets are sealed with it, and delivery opens them
    // again. Without one this would be testing a different code path.
    env = {
      ...testEnv(),
      WEBHOOK_KEK: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))),
    };
  });

  afterAll(async () => {
    for (const r of receivers) await new Promise((resolve) => r.server.close(resolve));
    if (orgId) await dropTestOrg(db, orgId);
    await close?.();
  });

  async function endpointFor(behaviour: Behaviour, eventTypes: string[] = []) {
    const receiver = await startReceiver(behaviour);
    receivers.push(receiver);
    const secret = generateSecret();
    const sealed = await sealSecret(env.WEBHOOK_KEK, secret);
    const [row] = await scoped.insert(webhookEndpoints, {
      url: receiver.url,
      secretCiphertext: sealed.ciphertext,
      secretIv: sealed.iv,
      eventTypes,
    });
    if (!row) throw new Error("no endpoint");
    return { receiver, secret, id: row.id };
  }

  async function emitEvent(type: string) {
    const [row] = await scoped.insert(events, {
      type: type as never,
      resourceType: "location",
      resourceId: crypto.randomUUID(),
      payload: { id: crypto.randomUUID(), name: "A location" },
      actorType: "system",
    });
    if (!row) throw new Error("no event");
    return row.id;
  }

  /**
   * The delivery for ONE endpoint.
   *
   * Every endpoint an earlier test registered with an empty filter subscribes
   * to everything, so a fan-out produces several deliveries and their order is
   * whatever the database returns. Taking `deliveryIds[0]` therefore picks a
   * different receiver from run to run — which is exactly how this file failed
   * intermittently before the helper existed.
   */
  async function deliveryFor(eventId: string, endpointId: string): Promise<string> {
    const [row] = await scoped.query(async (t, scope) =>
      t
        .select({ id: webhookDeliveries.id })
        .from(webhookDeliveries)
        .where(
          and(
            scope(webhookDeliveries),
            eq(webhookDeliveries.eventId, eventId),
            eq(webhookDeliveries.endpointId, endpointId),
          ),
        )
        .limit(1),
    );
    if (!row) throw new Error("no delivery for that endpoint");
    return row.id;
  }

  async function deliveryRow(id: string) {
    const [row] = await scoped.query(async (t, scope) =>
      t
        .select()
        .from(webhookDeliveries)
        .where(and(scope(webhookDeliveries), eq(webhookDeliveries.id, id)))
        .limit(1),
    );
    return row;
  }

  async function endpointRow(id: string) {
    const [row] = await scoped.query(async (t, scope) =>
      t
        .select()
        .from(webhookEndpoints)
        .where(and(scope(webhookEndpoints), eq(webhookEndpoints.id, id)))
        .limit(1),
    );
    return row;
  }

  it("signs a payload an integrator can verify from the documentation", async () => {
    const { receiver, secret, id: endpointId } = await endpointFor("ok");
    const eventId = await emitEvent("catalog.location.created");

    await fanOutEvent(db, eventId);
    const outcome = await attemptDelivery(db, env, await deliveryFor(eventId, endpointId));

    expect(outcome?.kind).toBe("delivered");
    expect(receiver.received).toHaveLength(1);

    const sent = receiver.received[0];
    if (!sent) throw new Error("nothing received");
    expect(
      await verifySignature(
        secret,
        sent.headers["roastery-signature"] ?? "",
        sent.headers["roastery-timestamp"] ?? "",
        sent.body,
      ),
    ).toBe(true);
  });

  it("refuses a signature checked against the wrong body", async () => {
    // Otherwise the check above would pass for any body at all.
    const { receiver, secret, id: endpointId } = await endpointFor("ok");
    const eventId = await emitEvent("catalog.location.created");
    await fanOutEvent(db, eventId);
    await attemptDelivery(db, env, await deliveryFor(eventId, endpointId));

    const sent = receiver.received[0];
    if (!sent) throw new Error("nothing received");
    expect(
      await verifySignature(
        secret,
        sent.headers["roastery-signature"] ?? "",
        sent.headers["roastery-timestamp"] ?? "",
        `${sent.body} tampered`,
      ),
    ).toBe(false);
  });

  it("delivers only to endpoints that subscribed to the type", async () => {
    const subscribed = await endpointFor("ok", ["catalog.location.created"]);
    const other = await endpointFor("ok", ["orders.order.created"]);

    const eventId = await emitEvent("catalog.location.created");
    const { deliveryIds } = await fanOutEvent(db, eventId);
    for (const deliveryId of deliveryIds) await attemptDelivery(db, env, deliveryId);

    expect(subscribed.receiver.received.length).toBeGreaterThan(0);
    expect(other.receiver.received).toHaveLength(0);
  });

  it("retries a 500 rather than giving up on it", async () => {
    const { id } = await endpointFor("server-error", ["quality.grading.recorded"]);
    const eventId = await emitEvent("quality.grading.recorded");
    await fanOutEvent(db, eventId);
    const deliveryId = await deliveryFor(eventId, id);

    const outcome = await attemptDelivery(db, env, deliveryId);
    expect(outcome?.kind).toBe("retry");
    expect((await deliveryRow(deliveryId))?.status).toBe("failed");
    // One failure is not a broken integration.
    expect((await endpointRow(id))?.disabledAt).toBeNull();
  });

  it("disables an endpoint that answers 410, without retrying", async () => {
    // 410 is the receiver saying the endpoint is gone for good. Retrying it
    // for six hours is pestering a server that has already answered.
    const { id } = await endpointFor("gone", ["orders.order.confirmed"]);
    const eventId = await emitEvent("orders.order.confirmed");
    await fanOutEvent(db, eventId);

    const outcome = await attemptDelivery(db, env, await deliveryFor(eventId, id));
    // Its own outcome, not a plain death: the endpoint is switched off rather
    // than this one delivery being abandoned.
    expect(outcome?.kind).toBe("disable_endpoint");
    expect((await endpointRow(id))?.disabledAt).not.toBeNull();
  });

  it("resets the failure count when a flaky endpoint recovers", async () => {
    // Consecutive failures, not cumulative: an endpoint that fails twice a
    // week for a year must not eventually disable itself.
    const { receiver, id } = await endpointFor("flaky", ["cafe.site.created"]);

    const first = await emitEvent("cafe.site.created");
    await fanOutEvent(db, first);
    await attemptDelivery(db, env, await deliveryFor(first, id));
    expect((await endpointRow(id))?.consecutiveFailures).toBeGreaterThan(0);

    receiver.healthy = true;
    const second = await emitEvent("cafe.site.created");
    await fanOutEvent(db, second);
    await attemptDelivery(db, env, await deliveryFor(second, id));

    expect((await endpointRow(id))?.consecutiveFailures).toBe(0);
    expect((await endpointRow(id))?.disabledAt).toBeNull();
  });

  it("fans out an event twice without duplicating deliveries", async () => {
    // The inline enqueue and the cron sweeper can both reach the same event,
    // which is safe only because the unique index makes the second a no-op.
    await endpointFor("ok", ["production.roast_batch.completed"]);
    const eventId = await emitEvent("production.roast_batch.completed");

    const first = await fanOutEvent(db, eventId);
    const second = await fanOutEvent(db, eventId);

    expect(first.deliveryIds.length).toBeGreaterThan(0);
    expect(second.deliveryIds).toHaveLength(0);
  });

  it("re-drives a due delivery through the sweeper, once", async () => {
    const { id } = await endpointFor("server-error", ["sourcing.contract.created"]);
    const eventId = await emitEvent("sourcing.contract.created");
    await fanOutEvent(db, eventId);

    const deliveryId = await deliveryFor(eventId, id);

    // Fail it, then bring its retry forward so the sweeper considers it due.
    await attemptDelivery(db, env, deliveryId);
    await scoped.update(
      webhookDeliveries,
      { nextAttemptAt: new Date(Date.now() - 1000) },
      eq(webhookDeliveries.id, deliveryId),
    );

    const claimed = await findDueDeliveries(db, 50);
    expect(claimed).toContain(deliveryId);

    // The claim is the point: a second sweep in the same window must not pick
    // it up again, or the receiver gets it twice and the failure counter
    // double-counts toward auto-disable.
    expect(await findDueDeliveries(db, 50)).not.toContain(deliveryId);
  });
});
