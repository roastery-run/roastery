import * as schema from "@roastery/db/schema";
import { allocations, greenLots, roastedLots, salesOrderLines } from "@roastery/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkerDb } from "../src/lib/db/db";
import type { OrgDb } from "../src/lib/db/org-db";
import { allocateOrderLine, releaseOrderLine } from "../src/lib/domain/allocation";
import { adjustReservation, kg } from "../src/lib/domain/inventory";
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
 * Reservations, under concurrency.
 *
 * A reservation is the one weight in the system with no ledger behind it: the
 * balance can always be recomputed from `SUM(delta_kg)`, but a reservation is
 * only ever the counter itself. So a lost update here is not a discrepancy
 * someone can find later — it is the same kilogram promised to two customers,
 * with nothing in the data to say so.
 *
 * Both write paths were a read-modify-write with no lock and no transaction
 * when this was written. These tests fail against that version.
 */
describe.skipIf(!hasTestDb)("reservations under concurrency", () => {
  let db: WorkerDb;
  let close: () => Promise<void>;
  let orgId: string;
  let scoped: OrgDb;
  let warehouse: string;

  beforeAll(async () => {
    ({ db, close } = connect());
    orgId = await createTestOrg(db);
    scoped = orgDb(db, orgId);
    warehouse = await createTestLocation(db, orgId, "WH");
  });

  afterAll(async () => {
    if (orgId) await dropTestOrg(db, orgId);
    await close?.();
  });

  async function reservedOn(lotId: string) {
    const [lot] = await scoped.query(async (t, scope) =>
      t
        .select({ reserved: greenLots.reservedWeightKg })
        .from(greenLots)
        .where(and(scope(greenLots), eq(greenLots.id, lotId)))
        .limit(1),
    );
    return kg.normalize(lot?.reserved ?? "0");
  }

  it("never promises the same kilogram twice when reserves race", async () => {
    const lotId = await seedLot(scoped, {
      lotCode: `RES-${crypto.randomUUID().slice(0, 6)}`,
      weightKg: "50.0000",
      locationId: warehouse,
    });

    // Ten concurrent attempts at 10 kg against 50 kg of stock. Exactly five can
    // succeed. Unlocked, all ten read `reserved = 0`, all ten pass the
    // availability check, and the lot ends up reserving 10 kg while ten orders
    // believe they hold stock.
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        scoped.transaction((tx) => adjustReservation(tx, lotId, "10.0000")),
      ),
    );

    const granted = attempts.filter((a) => a.status === "fulfilled").length;
    expect(granted).toBe(5);
    expect(await reservedOn(lotId)).toBe("50.0000");
  });

  it("refuses to reserve past the CURRENT balance, not the initial one", async () => {
    const lotId = await seedLot(scoped, {
      lotCode: `RES-${crypto.randomUUID().slice(0, 6)}`,
      weightKg: "20.0000",
      locationId: warehouse,
    });
    // Coffee already roasted is gone; reserving against it would promise
    // weight that no longer exists.
    const { applyInventoryTransaction } = await import("../src/lib/domain/inventory");
    await applyInventoryTransaction(scoped, {
      greenLotId: lotId,
      eventType: "roast_consume",
      deltaKg: "-15.0000",
      locationId: warehouse,
    });

    await expect(
      scoped.transaction((tx) => adjustReservation(tx, lotId, "10.0000")),
    ).rejects.toThrow(/unreserved/);
    await scoped.transaction((tx) => adjustReservation(tx, lotId, "5.0000"));
    expect(await reservedOn(lotId)).toBe("5.0000");
  });

  it("releases only what is reserved, even when releases race", async () => {
    const lotId = await seedLot(scoped, {
      lotCode: `RES-${crypto.randomUUID().slice(0, 6)}`,
      weightKg: "30.0000",
      locationId: warehouse,
    });
    await scoped.transaction((tx) => adjustReservation(tx, lotId, "30.0000"));

    const attempts = await Promise.allSettled(
      Array.from({ length: 6 }, () =>
        scoped.transaction((tx) => adjustReservation(tx, lotId, "-10.0000")),
      ),
    );

    expect(attempts.filter((a) => a.status === "fulfilled").length).toBe(3);
    // Never negative: a counter that can go below zero frees stock that was
    // never held.
    expect(await reservedOn(lotId)).toBe("0.0000");
  });
});

describe.skipIf(!hasTestDb)("order allocation", () => {
  let db: WorkerDb;
  let close: () => Promise<void>;
  const orgs: string[] = [];
  let scoped: OrgDb;

  beforeAll(async () => {
    ({ db, close } = connect());
  });

  /**
   * A fresh organization per test.
   *
   * Allocation deliberately considers every available lot in the org, so a lot
   * left behind by an earlier test is a legitimate candidate and FEFO may well
   * prefer it. Isolating the tenant is the honest fix; narrowing the query to
   * make the test pass would be testing something the product does not do.
   */
  beforeEach(async () => {
    const orgId = await createTestOrg(db);
    orgs.push(orgId);
    scoped = orgDb(db, orgId);
  });

  afterAll(async () => {
    for (const orgId of orgs) await dropTestOrg(db, orgId);
    await close?.();
  });

  async function seedRoastedLot(weightKg: string) {
    const [lot] = await scoped.insert(roastedLots, {
      name: "Roasted",
      lotCode: `RL-${crypto.randomUUID().slice(0, 6)}`,
      initialWeightKg: weightKg,
      currentWeightKg: weightKg,
      bestBeforeAt: new Date(Date.now() + 30 * 86_400_000),
    });
    if (!lot) throw new Error("no roasted lot");
    return lot.id;
  }

  async function seedOrderLine(weightKg: string) {
    const [customer] = await scoped.insert(schema.customers, {
      name: "Test customer",
      code: `C-${crypto.randomUUID().slice(0, 6)}`,
    });
    if (!customer) throw new Error("no customer");
    const [order] = await scoped.insert(schema.salesOrders, {
      orderNumber: `SO-${crypto.randomUUID().slice(0, 6)}`,
      customerId: customer.id,
      status: "confirmed",
    });
    if (!order) throw new Error("no order");
    const [line] = await scoped.insert(salesOrderLines, {
      orderId: order.id,
      description: "Line",
      quantity: "1",
      weightKg,
    });
    if (!line) throw new Error("no line");
    return line.id;
  }

  async function openAllocated(lotId: string) {
    const [row] = await scoped.query(async (t, scope) =>
      t
        .select({ total: sql<string>`coalesce(sum(${allocations.weightKg}), 0)::text` })
        .from(allocations)
        .where(
          and(
            scope(allocations),
            eq(allocations.roastedLotId, lotId),
            isNull(allocations.releasedAt),
          ),
        ),
    );
    return kg.normalize(row?.total ?? "0");
  }

  async function reservedOnRoasted(lotId: string) {
    const [lot] = await scoped.query(async (t, scope) =>
      t
        .select({ reserved: roastedLots.reservedWeightKg })
        .from(roastedLots)
        .where(and(scope(roastedLots), eq(roastedLots.id, lotId)))
        .limit(1),
    );
    return kg.normalize(lot?.reserved ?? "0");
  }

  it("keeps the lot's reservation equal to its open allocations when lines race", async () => {
    // One lot, two lines, both wanting all of it. The reservation counter and
    // the allocation rows are the same fact stored twice, and the
    // reconciliation job compares them — so this is the property that keeps
    // that comparison meaningful.
    const lotId = await seedRoastedLot("40.0000");
    const lineA = await seedOrderLine("40.0000");
    const lineB = await seedOrderLine("40.0000");

    await Promise.allSettled([
      scoped.transaction((tx) => allocateOrderLine(tx, lineA)),
      scoped.transaction((tx) => allocateOrderLine(tx, lineB)),
    ]);

    expect(await reservedOnRoasted(lotId)).toBe("40.0000");
    expect(await openAllocated(lotId)).toBe("40.0000");
  });

  it("reports a shortfall rather than over-allocating", async () => {
    const lotId = await seedRoastedLot("5.0000");
    const line = await seedOrderLine("12.0000");

    const result = await scoped.transaction((tx) => allocateOrderLine(tx, line));

    expect(result.allocatedKg).toBe("5.0000");
    expect(result.shortfallKg).toBe("7.0000");
    expect(await reservedOnRoasted(lotId)).toBe("5.0000");
  });

  it("rolls back every line's claim when one line fails", async () => {
    const lotId = await seedRoastedLot("20.0000");
    const lineA = await seedOrderLine("5.0000");

    // The shape of allocateOrder: several lines in one transaction. A failure
    // partway through used to keep the claims already made — stock reserved
    // against an order reporting as unallocated, released by nothing.
    await expect(
      scoped.transaction(async (tx) => {
        await allocateOrderLine(tx, lineA);
        throw new Error("second line failed");
      }),
    ).rejects.toThrow("second line failed");

    expect(await reservedOnRoasted(lotId)).toBe("0.0000");
    expect(await openAllocated(lotId)).toBe("0.0000");
  });

  it("returns the stock when the line is released", async () => {
    const lotId = await seedRoastedLot("15.0000");
    const line = await seedOrderLine("15.0000");

    await scoped.transaction((tx) => allocateOrderLine(tx, line));
    expect(await reservedOnRoasted(lotId)).toBe("15.0000");

    const released = await scoped.transaction((tx) => releaseOrderLine(tx, line));
    expect(released).toBe("15.0000");
    expect(await reservedOnRoasted(lotId)).toBe("0.0000");
    expect(await openAllocated(lotId)).toBe("0.0000");
  });
});
