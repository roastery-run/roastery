import { locations, orgMembers, users } from "@roastery/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/index";
import { RPC_REGISTRY } from "../src/lib/api/rpc";
import { issueApiKey, revokeApiKey } from "../src/lib/auth/api-keys";
import type { WorkerDb } from "../src/lib/db/db";
import type { OrgDb } from "../src/lib/db/org-db";
import { rpcRequest, testEnv } from "./helpers/app";
import { connect, createTestOrg, dropTestOrg, hasTestDb, orgDb } from "./helpers/db";

/**
 * Checks 5 and 8 of the authorization gate, which its own header has listed as
 * "Phase 2, needs a database" since it was written.
 *
 * Everything the static suite does is worth doing, and none of it issues a
 * request. So the documented failure ORDER — 401 authn, then 403 org access,
 * then 402 entitlement, then 403 permission — was a comment, and the property
 * that actually keeps two roasters' inventory apart had no test at all.
 *
 * Probed against every registered operation rather than a sample: the
 * interesting failure is always the one operation somebody added without the
 * care the others got, and a sample is exactly what misses it.
 */
describe.skipIf(!hasTestDb)("authorization, over HTTP", () => {
  let db: WorkerDb;
  let close: () => Promise<void>;
  let orgA: string;
  let orgB: string;
  let scopedA: OrgDb;
  let viewerKey: string;
  let ownerKeyB: string;
  const env = testEnv();

  async function member(orgId: string, roleSlug: string): Promise<string> {
    const id = crypto.randomUUID();
    await db
      .insert(users)
      .values({ id, email: `${id}@example.test`, name: "Test" })
      .onConflictDoNothing();
    await orgDb(db, orgId).insert(orgMembers, { userId: id, roleSlug });
    return id;
  }

  beforeAll(async () => {
    ({ db, close } = connect());
    orgA = await createTestOrg(db);
    orgB = await createTestOrg(db);
    scopedA = orgDb(db, orgA);

    await member(orgA, "viewer");
    // A viewer reads but holds almost no write permission, which is what makes
    // it the right credential for probing the permission layer.
    viewerKey = (await issueApiKey(scopedA, { name: "viewer", roleSlug: "viewer" })).key;
    ownerKeyB = (await issueApiKey(orgDb(db, orgB), { name: "owner", roleSlug: "owner" })).key;
  });

  afterAll(async () => {
    for (const orgId of [orgA, orgB]) if (orgId) await dropTestOrg(db, orgId);
    await close?.();
  });

  const operations = RPC_REGISTRY.map((def) => `${def.namespace}.${def.operation}`);

  it("has operations to probe", () => {
    expect(operations.length).toBeGreaterThan(50);
  });

  /* ------------------------------------------------------------- check 5 */

  it("answers 401 to an unauthenticated caller, before validating the body", async () => {
    // The ordering that matters most, and the one a comment cannot enforce:
    // middleware runs ahead of Hono's Zod validator, so a caller with no
    // credential and a malformed body learns nothing about the request schema.
    const failures: string[] = [];
    for (const name of operations) {
      const response = await app.fetch(rpcRequest(name, { body: { nonsense: true } }), env);
      if (response.status !== 401) failures.push(`${name} to ${response.status}`);
    }
    expect(failures).toEqual([]);
  });

  it("answers 401 before 400 even when the body is not JSON at all", async () => {
    const response = await app.fetch(
      new Request("http://localhost/rpc/v1/catalog.location.listLocations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
      env,
    );
    expect(response.status).toBe(401);
  });

  it("answers 403, not 404, when a credential names an organization it cannot act in", async () => {
    // Deliberately indistinguishable from "does not exist": a 404 would
    // confirm the id of an organization the caller has no business knowing.
    const response = await app.fetch(
      rpcRequest("catalog.location.listLocations", { apiKey: ownerKeyB, orgId: orgA }),
      env,
    );
    expect(response.status).toBe(403);
  });

  it("answers 403 for a permission the credential's role does not hold", async () => {
    const response = await app.fetch(
      rpcRequest("catalog.location.createLocation", {
        apiKey: viewerKey,
        orgId: orgA,
        body: { name: "New", code: "NEW", kind: "warehouse" },
      }),
      env,
    );
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBeTruthy();
  });

  it("lets the same credential through where its role does hold the permission", async () => {
    // Without this, everything above would pass just as well against a chain
    // that refuses every request.
    const response = await app.fetch(
      rpcRequest("catalog.location.listLocations", { apiKey: viewerKey, orgId: orgA }),
      env,
    );
    expect(response.status).toBe(200);
  });

  it("refuses a revoked key immediately", async () => {
    const issued = await issueApiKey(scopedA, { name: "temp", roleSlug: "viewer" });
    await revokeApiKey(scopedA, issued.id);

    const response = await app.fetch(
      rpcRequest("catalog.location.listLocations", { apiKey: issued.key, orgId: orgA }),
      env,
    );
    // Not at the next cache expiry: authorization reads go through the
    // cache-disabled handle precisely so revocation takes effect now.
    expect(response.status).toBe(401);
  });

  /* ------------------------------------------------------------- check 8 */

  it("never returns another organization's rows from any list operation", async () => {
    await scopedA.insert(locations, { name: "A warehouse", code: "AWH", kind: "warehouse" });

    const listOperations = operations.filter((name) => /\.list[A-Z]/.test(name));
    expect(listOperations.length).toBeGreaterThan(10);

    const leaks: string[] = [];
    for (const name of listOperations) {
      const response = await app.fetch(rpcRequest(name, { apiKey: ownerKeyB, orgId: orgB }), env);
      // 402 and 400 are acceptable: B's plan may not include the module, and
      // some lists require a filter. What must never appear is A's data.
      if (response.status !== 200) continue;
      const text = await response.text();
      if (text.includes("A warehouse") || text.includes("AWH") || text.includes(orgA)) {
        leaks.push(name);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("refuses to act in an organization the credential does not belong to", async () => {
    const response = await app.fetch(
      rpcRequest("catalog.location.listLocations", { apiKey: viewerKey, orgId: orgB }),
      env,
    );
    expect(response.status).toBe(403);
  });
});
