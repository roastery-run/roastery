import { roastBatches } from "@roastery/db/schema";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { Env } from "../env";
import { type AuthVariables, authMiddleware } from "../lib/auth/auth-middleware";
import { getOrgMembership } from "../lib/auth/org-scope";
import { can, loadPermissions } from "../lib/auth/permissions";

/**
 * The live roast WebSocket.
 *
 * Authorization happens HERE, in the Worker, not in the Durable Object: the DO
 * has no database and no notion of who a caller is, and passing an
 * unauthenticated socket to it would make the org boundary a suggestion. The
 * Worker verifies membership and permission, then injects the viewer's rights
 * as headers the client cannot set for itself.
 */
export const streamRoutes = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

streamRoutes.use("/stream/v1/*", authMiddleware);

streamRoutes.get("/stream/v1/roast/:batchId", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.json({ error: "Expected a WebSocket upgrade" }, 426);
  }

  const auth = c.var.auth;
  const cred = auth.credential;
  const machine = cred && cred.type !== "session" ? cred : null;

  const requestedOrg = c.req.query("org") ?? machine?.orgId ?? null;
  if (!requestedOrg) return c.json({ error: "Organization is required" }, 400);
  if (machine && machine.orgId !== requestedOrg) {
    return c.json({ error: "Credential is not scoped to that organization" }, 403);
  }

  let roleSlug: string;
  if (machine) {
    roleSlug = machine.roleSlug;
  } else {
    if (!auth.userId) return c.json({ error: "Unauthorized" }, 401);
    const member = await getOrgMembership(c.var.unsafeDb, requestedOrg, auth.userId);
    if (!member) return c.json({ error: "Forbidden" }, 403);
    roleSlug = member.roleSlug;
  }

  const perms = await loadPermissions(
    c.env,
    c.var.unsafeDb,
    requestedOrg,
    roleSlug,
    machine ? machine.scopes : null,
  );
  if (!can(perms, "production.roast.read")) {
    return c.json({ error: "Forbidden", required: "production.roast.read" }, 403);
  }

  const batchId = c.req.param("batchId");
  const [batch] = await c.var.unsafeDb
    .select({ id: roastBatches.id })
    .from(roastBatches)
    .where(and(eq(roastBatches.id, batchId), eq(roastBatches.orgId, requestedOrg)))
    .limit(1);
  // Indistinguishable from "does not exist": a non-member must not be able to
  // probe which batch ids are real.
  if (!batch) return c.json({ error: "Not found" }, 404);

  const stub = c.env.ROAST_BATCH.get(c.env.ROAST_BATCH.idFromName(`${requestedOrg}:${batchId}`));

  // Marking events is a WRITE — a roaster tapping "first crack" changes the
  // record — so viewers without that permission connect read-only. The header
  // is set here, server-side; the client cannot grant itself write access.
  const canWrite = can(perms, "production.roast.write");

  // The Upgrade header MUST survive the hop to the Durable Object. Building a
  // fresh Request and setting only our own header drops it, and the runtime
  // then refuses the socket the object hands back — "tried to return a
  // WebSocket in a response to a request which did not contain the header
  // Upgrade: websocket". Copy the incoming headers, then add ours.
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-Viewer-Write", canWrite ? "1" : "0");

  return stub.fetch(new Request("https://do/ws", { headers })) as unknown as Response;
});
