import * as schema from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { WorkerDb } from "../../src/lib/db";
import { createOrgDb, type OrgDb } from "../../src/lib/org-db";

/**
 * A real database connection for integration tests.
 *
 * The ledger invariant cannot be checked statically — its whole point is what
 * Postgres does under concurrent transactions — so these tests need a real
 * server. They skip when TEST_DATABASE_URL is unset, so the fast loop stays
 * fast; CI sets it.
 *
 * Uses postgres-js, the driver the Worker actually runs, rather than
 * node-postgres. Testing the ledger against a different driver would leave the
 * interesting differences untested: prepared statements, and how transactions
 * are held open.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const hasTestDb = Boolean(TEST_DATABASE_URL);

export function connect(): { db: WorkerDb; close: () => Promise<void> } {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  // More than one connection: the concurrency test needs genuinely parallel
  // transactions, which a pool of one would serialize and make the test pass
  // for the wrong reason.
  const client = postgres(TEST_DATABASE_URL, { prepare: false, max: 10 });
  return { db: drizzle(client, { schema }) as WorkerDb, close: () => client.end({ timeout: 5 }) };
}

export function orgDb(db: WorkerDb, orgId: string): OrgDb {
  return createOrgDb(db, orgId, { id: null, type: "system", userId: null });
}

/** A throwaway organization, so concurrent test runs never collide. */
export async function createTestOrg(db: WorkerDb): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [org] = await db
    .insert(schema.organizations)
    .values({ name: `Test ${suffix}`, slug: `test-${suffix}`, baseCurrency: "USD" })
    .returning();
  if (!org) throw new Error("Failed to create test organization");
  return org.id;
}

export async function createTestLocation(
  db: WorkerDb,
  orgId: string,
  code: string,
): Promise<string> {
  const [loc] = await db
    .insert(schema.locations)
    .values({ orgId, name: `Location ${code}`, code, kind: "warehouse" })
    .returning();
  if (!loc) throw new Error("Failed to create test location");
  return loc.id;
}

/** Creates a lot the way importGreenLot does: at zero, then a receive row. */
export async function seedLot(
  db: OrgDb,
  input: { lotCode: string; weightKg: string; locationId?: string },
): Promise<string> {
  const [lot] = await db.insert(schema.greenLots, {
    name: `Lot ${input.lotCode}`,
    lotCode: input.lotCode,
    initialWeightKg: input.weightKg,
    currentWeightKg: "0",
    defaultLocationId: input.locationId ?? null,
  });
  if (!lot) throw new Error("Failed to create test lot");

  const { applyInventoryTransaction } = await import("../../src/lib/inventory");
  await applyInventoryTransaction(db, {
    greenLotId: lot.id,
    eventType: "receive",
    deltaKg: input.weightKg,
    locationId: input.locationId ?? null,
  });
  return lot.id;
}

/** Deleting the organization cascades to everything a test created. */
export async function dropTestOrg(db: WorkerDb, orgId: string): Promise<void> {
  await db.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
}
