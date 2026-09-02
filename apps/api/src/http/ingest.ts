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

type BridgeContext = { orgId: string; machineId: string; tokenId: string };

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
    return { orgId: token.orgId, machineId: token.machineId, tokenId: token.id };
  } finally {
    await closeWorkerDb(db);
  }
}

ingestRoutes.post("/ingest/v1/roast/:batchId/samples", async (c) => {
  const bridge = await authenticateBridge(c.env, c.req.header("Authorization"));
  if (!bridge) return c.json({ ok: false, error: "unauthorized" }, 401);

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
