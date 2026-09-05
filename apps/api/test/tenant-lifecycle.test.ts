import { greenLots, organizations } from "@roastery/db/schema";
import { TENANT_DIRECT, TENANT_VIA } from "@roastery/db/tenancy";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkerDb } from "../src/lib/db/db";
import type { OrgDb } from "../src/lib/db/org-db";
import { exportedTableNames, purgeOrg } from "../src/lib/domain/tenant-lifecycle";
import {
  connect,
  createTestLocation,
  createTestOrg,
  dropTestOrg,
  hasTestDb,
  orgDb,
  seedLot,
} from "./helpers/db";

/**
 * Getting a business's data out, and getting rid of it.
 *
 * Two things a customer is entitled to, and the two where being approximately
 * right is worse than not offering them: an export missing a table is a
 * promise quietly broken, and a deletion that leaves data behind is the same.
 */
describe("export coverage", () => {
  it("covers every tenant table, or excludes it deliberately", () => {
    // The property that matters, and the reason the export is built on
    // `tenancy.ts` rather than a list kept beside it. A new table must be
    // classified there or the authorization test fails the build — so it
    // joins the export automatically, and this fails if somebody excludes one
    // without saying so here.
    const classified = [...Object.keys(TENANT_DIRECT), ...Object.keys(TENANT_VIA)].sort();
    const exported = exportedTableNames();
    const excluded = classified.filter((name) => !exported.includes(name));

    expect(excluded.sort()).toEqual([
      // Credential material: hashes are useless to the recipient and a gift to
      // anybody else who gets the file.
      "api_keys",
      // The export's own bookkeeping.
      "data_exports",
      "machine_bridge_tokens",
      // Signing secrets, sealed with a key that is not in the database.
      "webhook_endpoints",
    ]);
    // `oauth_clients` is absent from both lists because it is classified
    // GLOBAL rather than tenant-scoped — the plugin keys it by referenceId.
    // The exclusion list names it anyway, so reclassifying it later cannot
    // silently put client secrets into an export.
    expect(classified).not.toContain("oauth_clients");
  });

  it("exports the tables a roaster would actually ask for", () => {
    const exported = exportedTableNames();
    for (const table of [
      "green_lots",
      "inventory_transactions",
      "roast_batches",
      "roast_samples",
      "cupping_scores",
      "sales_orders",
      "espresso_shots",
      "audit_events",
    ]) {
      expect(exported, table).toContain(table);
    }
  });
});

describe.skipIf(!hasTestDb)("organization deletion", () => {
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

  const env = {} as Parameters<typeof purgeOrg>[1];

  async function mark(purgeAfter: Date) {
    await db
      .update(organizations)
      .set({ deletedAt: new Date(), purgeAfter })
      .where(eq(organizations.id, orgId));
  }

  it("does not purge before the grace period is up", async () => {
    const warehouse = await createTestLocation(db, orgId, "WH");
    await seedLot(scoped, { lotCode: "KEEP-1", weightKg: "10.0000", locationId: warehouse });

    // The whole point of the grace period: somebody who deleted the wrong
    // organization has a window in which that is fixable.
    await mark(new Date(Date.now() + 7 * 86_400_000));
    await purgeOrg(db, env, orgId);

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(org).toBeTruthy();
    const lots = await scoped.query(async (t, scope) =>
      t.select().from(greenLots).where(scope(greenLots)),
    );
    expect(lots).toHaveLength(1);
  });

  it("does not purge an organization nobody deleted", async () => {
    await purgeOrg(db, env, orgId);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(org).toBeTruthy();
  });

  it("removes the organization and everything scoped to it once the period passes", async () => {
    const warehouse = await createTestLocation(db, orgId, "WH");
    await seedLot(scoped, { lotCode: "GONE-1", weightKg: "10.0000", locationId: warehouse });

    await mark(new Date(Date.now() - 1000));
    await purgeOrg(db, env, orgId);

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    expect(org).toBeUndefined();

    // The cascade is what actually removes the data; this asserts it reaches
    // the ledger rows too, not only the parent.
    const lots = await scoped.query(async (t, scope) =>
      t.select().from(greenLots).where(scope(greenLots)),
    );
    expect(lots).toHaveLength(0);
  });
});
