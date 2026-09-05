import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { organizations } from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyApiKey } from "../src/lib/auth/api-keys";
import type { WorkerDb } from "../src/lib/db/db";
import { connect, dropTestOrg, hasTestDb, TEST_DATABASE_URL } from "./helpers/db";

/**
 * How the first customer comes to exist.
 *
 * `bootstrap-org.mjs` is the only script that writes Postgres directly, and it
 * has to be: every RPC operation is scoped to an organization, so the first one
 * cannot be created through the API that requires it. That makes it the single
 * step between a migrated production database and a customer who can sign in —
 * and nothing exercised it.
 *
 * The specific hazard is the API key it prints. The script hashed it with a
 * hand-written SHA-256 line, on the belief that the plugin's hasher was not
 * exported; it is, and the two agreeing was luck that would have run out at a
 * version bump. The failure mode is the worst shape available: the script
 * succeeds, prints a key, and that key is rejected as an invalid credential on
 * the first request of a new customer's onboarding.
 *
 * So this runs the real script against a real database and then authenticates
 * with what it printed, through the same function a request would.
 */
describe.skipIf(!hasTestDb)("bootstrap-org", () => {
  let db: WorkerDb;
  let close: () => Promise<void>;
  let orgId: string;
  let key: string;

  beforeAll(async () => {
    ({ db, close } = connect());

    const slug = `bootstrap-test-${crypto.randomUUID().slice(0, 8)}`;
    const output = execFileSync(
      "node",
      [
        join(import.meta.dirname, "..", "scripts", "bootstrap-org.mjs"),
        "--name",
        "Bootstrap Test",
        "--slug",
        slug,
        "--email",
        `${slug}@example.test`,
      ],
      { env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL }, encoding: "utf8" },
    );

    const printed = JSON.parse(output) as { orgId: string; key: string };
    orgId = printed.orgId;
    key = printed.key;
  });

  afterAll(async () => {
    if (orgId) await dropTestOrg(db, orgId);
    await close?.();
  });

  it("creates an organization", async () => {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(org?.name).toBe("Bootstrap Test");
  });

  it("prints a key that actually authenticates", async () => {
    // The whole point. A key that cannot verify is indistinguishable from a
    // successful bootstrap until somebody tries to use it.
    const verified = await verifyApiKey(db, key);
    expect(verified).not.toBeNull();
    // `referenceId` is the organization: the plugin's own column name for what
    // a key belongs to.
    expect(verified?.referenceId).toBe(orgId);
    expect(verified?.metadata.roleSlug).toBe("owner");
  });

  it("prints a key shaped like every other API key", () => {
    expect(key.startsWith("sk_")).toBe(true);
  });
});
