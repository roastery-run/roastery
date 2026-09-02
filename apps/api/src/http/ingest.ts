import { machineBridgeTokens, roastBatches } from "@roastery/db/schema";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { IngestBody, RoastBatchDO } from "../durable-objects/roast-batch";
import type { Env } from "../env";
import { sha256 } from "../lib/crypto";
import { closeWorkerDb, createWorkerDb, safeExecutionCtx } from "../lib/db/db";

/**
 * Telemetry ingest.
 *
 * Separate from /rpc/v1 deliberately: it routes straight to a Durable Object
 * with no Postgres client on the hot path, carries a different credential, and
 * needs a rate budget two orders of magnitude higher than the business API.
 *
 * The credential is a MACHINE BRIDGE TOKEN — scoped to one machine, short
 * lived, and able to do nothing but stream. The realistic threat here is a
 * shop-floor PC that is physically accessible and rarely patched, so it must
 * never hold something that could act on the rest of the organization.
 */
export const ingestRoutes = new Hono<{ Bindings: Env }>();

/**
 * A bridge is scoped to exactly one machine, and that machine is either a
 * roaster or bar equipment. Which one is a property of the token, not of the
 * request — a bar bridge cannot post a roast curve by asking nicely.
 */
type BridgeContext = {
  orgId: string;
  tokenId: string;
  machineId: string | null;
  cafeMachineId: string | null;
};

async function authenticateBridge(
  env: Env,
  header: string | undefined,
): Promise<BridgeContext | null> {
  if (!header?.startsWith("Bearer rb_")) return null;
  const db = createWorkerDb(env);
  try {
    const hash = await sha256(header.slice("Bearer ".length));
    const [token] = await db
      .select()
      .from(machineBridgeTokens)
      .where(eq(machineBridgeTokens.tokenHash, hash))
      .limit(1);

    if (!token || token.revokedAt || token.expiresAt <= new Date()) return null;
    return {
      orgId: token.orgId,
      tokenId: token.id,
      machineId: token.machineId,
      cafeMachineId: token.cafeMachineId,
    };
  } finally {
    await closeWorkerDb(db);
  }
}

ingestRoutes.post("/ingest/v1/roast/:batchId/samples", async (c) => {
  const bridge = await authenticateBridge(c.env, c.req.header("Authorization"));
  if (!bridge) return c.json({ ok: false, error: "unauthorized" }, 401);
  if (!bridge.machineId) {
    return c.json({ ok: false, error: "not_a_roaster_bridge" }, 403);
  }

  const batchId = c.req.param("batchId");
  let body: IngestBody;
  try {
    body = await c.req.json<IngestBody>();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }
  if (typeof body.seq !== "number" || !Array.isArray(body.samples)) {
    return c.json({ ok: false, error: "invalid_body" }, 400);
  }
  // A machine posts every second or so; a huge batch is a bug or an attack.
  if (body.samples.length > 200) {
    return c.json({ ok: false, error: "too_many_samples" }, 400);
  }

  // Verify the batch belongs to this bridge's machine BEFORE touching the DO,
  // so a token cannot stream into another machine's roast.
  const db = createWorkerDb(c.env);
  try {
    const [batch] = await db
      .select({ id: roastBatches.id })
      .from(roastBatches)
      .where(
        and(
          eq(roastBatches.id, batchId),
          eq(roastBatches.orgId, bridge.orgId),
          eq(roastBatches.machineId, bridge.machineId),
        ),
      )
      .limit(1);
    if (!batch) return c.json({ ok: false, error: "unknown_batch" }, 404);
  } finally {
    await closeWorkerDb(db, safeExecutionCtx(c));
  }

  const stub = c.env.ROAST_BATCH.get(
    c.env.ROAST_BATCH.idFromName(`${bridge.orgId}:${batchId}`),
  ) as unknown as RoastBatchDO;

  const ack = await stub.ingest(body);
  // A backpressure refusal is a 429, not a 400: the bridge should retry, not
  // conclude its payload was malformed.
  return c.json(ack, ack.ok ? 200 : ack.error === "backpressure" ? 429 : 409);
});

/**
 * Espresso shot ingest.
 *
 * Batched onto a queue rather than written inline, and deliberately NOT given
 * a Durable Object per machine. A shot is an event, not a session: 28 seconds,
 * already over before anyone looks. A twenty-group chain produces about 0.1
 * writes a second in aggregate, so an object per machine would be thousands of
 * objects each handling one write every few minutes.
 *
 * The response is an acknowledgement that the batch was ACCEPTED, not that it
 * was stored. That is the honest contract for a queue, and the bridge does not
 * need more: dedupe on the bridge's own shot id means a replay after an
 * uncertain response costs nothing.
 */
ingestRoutes.post("/ingest/v1/cafe/shots", async (c) => {
  const bridge = await authenticateBridge(c.env, c.req.header("Authorization"));
  if (!bridge) return c.json({ ok: false, error: "unauthorized" }, 401);
  if (!bridge.cafeMachineId) {
    return c.json({ ok: false, error: "not_a_cafe_bridge" }, 403);
  }

  let body: { siteId?: string; shots?: unknown[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid_json" }, 400);
  }

  const shots = Array.isArray(body.shots) ? body.shots : null;
  if (!body.siteId || !shots) {
    return c.json({ ok: false, error: "siteId and shots are required" }, 400);
  }
  // A bar posts a handful at a time; a huge batch is a bug or an attack. The
  // bridge chunks its replay buffer rather than sending a day in one request.
  if (shots.length > 500) {
    return c.json({ ok: false, error: "too_many_shots", max: 500 }, 413);
  }

  if (!c.env.SHOT_QUEUE) {
    return c.json({ ok: false, error: "ingest_unavailable" }, 503);
  }

  await c.env.SHOT_QUEUE.send({
    orgId: bridge.orgId,
    siteId: body.siteId,
    // From the TOKEN, never the body. A machine id a caller can choose would
    // let a compromised bar write shots for another site's equipment.
    machineId: bridge.cafeMachineId,
    shots,
  });

  return c.json({ ok: true, accepted: shots.length });
});
