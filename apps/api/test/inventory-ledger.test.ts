import { greenLots, inventoryTransactions, lotLocationBalances } from "@roastery/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkerDb } from "../src/lib/db";
import {
  applyInventoryTransaction,
  kg,
  ledgerDrift,
  transferBetweenLocations,
} from "../src/lib/inventory";
import type { OrgDb } from "../src/lib/org-db";
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
 * The ledger invariant, checked against a real Postgres.
 *
 * This is the one property the inventory design cannot be trusted without:
 * SUM(delta_kg) must equal the cached balance, for every lot, always —
 * including when several writers move the same lot at once. It cannot be
 * asserted statically, because what is being tested is what Postgres does
 * under concurrent transactions.
 *
 * Skipped without TEST_DATABASE_URL so the fast loop stays fast. If these ever
 * silently skip in CI, the ledger is unverified — turbo.json declares
 * TEST_DATABASE_URL in the test task's env for exactly that reason.
 */
describe.skipIf(!hasTestDb)("inventory ledger", () => {
  let db: WorkerDb;
  let close: () => Promise<void>;
  let orgId: string;
  let scoped: OrgDb;
  let warehouse: string;
  let store: string;

  beforeAll(async () => {
    ({ db, close } = connect());
    orgId = await createTestOrg(db);
    scoped = orgDb(db, orgId);
    warehouse = await createTestLocation(db, orgId, "WH");
    store = await createTestLocation(db, orgId, "ST");
  });

  afterAll(async () => {
    if (orgId) await dropTestOrg(db, orgId);
    await close?.();
  });

  async function drift(lotId: string) {
    return (await ledgerDrift(scoped, lotId)).drift;
  }

  it("books an opening balance as a ledger row, not a bare column write", async () => {
    const lot = await seedLot(scoped, { lotCode: `OPEN-${Date.now()}`, weightKg: "1000" });
    const rows = await db
      .select()
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.greenLotId, lot));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventType).toBe("receive");
    // Opening at zero and receiving is what makes the ledger explain the WHOLE
    // balance rather than most of it.
    expect(rows[0]?.weightBeforeKg).toBe("0.0000");
    expect(rows[0]?.weightAfterKg).toBe("1000.0000");
    expect(await drift(lot)).toBe("0.0000");
  });

  it("holds the invariant across a realistic sequence of movements", async () => {
    const lot = await seedLot(scoped, {
      lotCode: `SEQ-${Date.now()}`,
      weightKg: "18975",
      locationId: warehouse,
    });

    await applyInventoryTransaction(scoped, {
      greenLotId: lot,
      eventType: "shrinkage",
      deltaKg: "-12.5",
      locationId: warehouse,
    });
    await transferBetweenLocations(scoped, {
      greenLotId: lot,
      fromLocationId: warehouse,
      toLocationId: store,
      weightKg: "5000",
    });
    await applyInventoryTransaction(scoped, {
      greenLotId: lot,
      eventType: "roast_consume",
      deltaKg: "-240.75",
      locationId: store,
    });

    const [row] = await db.select().from(greenLots).where(eq(greenLots.id, lot));
    expect(row?.currentWeightKg).toBe("18721.7500");
    expect(await drift(lot)).toBe("0.0000");
  });

  it("keeps per-location balances additive and equal to the lot total", async () => {
    const lot = await seedLot(scoped, {
      lotCode: `LOC-${Date.now()}`,
      weightKg: "900",
      locationId: warehouse,
    });
    await transferBetweenLocations(scoped, {
      greenLotId: lot,
      fromLocationId: warehouse,
      toLocationId: store,
      weightKg: "350",
    });

    const balances = await db
      .select()
      .from(lotLocationBalances)
      .where(eq(lotLocationBalances.greenLotId, lot));

    const total = balances.reduce((acc, b) => kg.add(acc, b.weightKg), "0");
    expect(total).toBe("900.0000");
    // A transfer must not change the lot total, only where it sits. One signed
    // row instead of two would break this.
    expect(await drift(lot)).toBe("0.0000");
  });

  it("refuses to take a lot negative", async () => {
    const lot = await seedLot(scoped, { lotCode: `NEG-${Date.now()}`, weightKg: "10" });
    await expect(
      applyInventoryTransaction(scoped, {
        greenLotId: lot,
        eventType: "adjust",
        deltaKg: "-11",
      }),
    ).rejects.toThrow(/Insufficient stock/);
    expect(await drift(lot)).toBe("0.0000");
  });

  it("allows a recount to go negative, because a physical count is the truth", async () => {
    const lot = await seedLot(scoped, { lotCode: `RC-${Date.now()}`, weightKg: "10" });
    await applyInventoryTransaction(scoped, {
      greenLotId: lot,
      eventType: "recount",
      deltaKg: "-11",
      allowNegative: true,
    });
    const [row] = await db.select().from(greenLots).where(eq(greenLots.id, lot));
    expect(row?.currentWeightKg).toBe("-1.0000");
    // Even a negative balance must still be explained by the ledger.
    expect(await drift(lot)).toBe("0.0000");
  });

  /**
   * The reason the per-lot sequence has a unique index.
   *
   * Without serialization, concurrent writers read the same balance and the
   * last write silently discards the others — the classic lost update, and the
   * failure mode that would make every inventory figure quietly wrong.
   */
  it("loses no updates when many writers move the same lot at once", async () => {
    const lot = await seedLot(scoped, {
      lotCode: `CONC-${Date.now()}`,
      weightKg: "10000",
      locationId: warehouse,
    });

    const WRITERS = 40;
    const EACH = "-25";
    await Promise.all(
      Array.from({ length: WRITERS }, () =>
        applyInventoryTransaction(scoped, {
          greenLotId: lot,
          eventType: "adjust",
          deltaKg: EACH,
          locationId: warehouse,
        }),
      ),
    );

    const [row] = await db.select().from(greenLots).where(eq(greenLots.id, lot));
    expect(row?.currentWeightKg).toBe("9000.0000");
    expect(await drift(lot)).toBe("0.0000");

    // Every writer got its own sequence number: none collided, none were lost.
    const [counted] = await db
      .select({
        rows: sql<number>`count(*)::int`,
        distinctSeq: sql<number>`count(distinct ${inventoryTransactions.seq})::int`,
        maxSeq: sql<number>`max(${inventoryTransactions.seq})::int`,
      })
      .from(inventoryTransactions)
      .where(eq(inventoryTransactions.greenLotId, lot));

    expect(counted?.rows).toBe(WRITERS + 1);
    expect(counted?.distinctSeq).toBe(WRITERS + 1);
    // Gapless: a gap would mean a transaction rolled back after taking a number.
    expect(counted?.maxSeq).toBe(WRITERS + 1);
  });

  it("keeps every ledger row independently auditable", async () => {
    const lot = await seedLot(scoped, {
      lotCode: `AUD-${Date.now()}`,
      weightKg: "500",
      locationId: warehouse,
    });
    for (const delta of ["-10", "-0.5", "25", "-3.25"]) {
      await applyInventoryTransaction(scoped, {
        greenLotId: lot,
        eventType: "adjust",
        deltaKg: delta,
        locationId: warehouse,
      });
    }

    // before + delta = after on EVERY row, so an auditor can verify any single
    // row without replaying the whole history.
    const [broken] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(inventoryTransactions)
      .where(
        and(
          eq(inventoryTransactions.greenLotId, lot),
          sql`${inventoryTransactions.weightBeforeKg} + ${inventoryTransactions.deltaKg}
              <> ${inventoryTransactions.weightAfterKg}`,
        ),
      );
    expect(broken?.n).toBe(0);
    expect(await drift(lot)).toBe("0.0000");
  });
});

/**
 * Guards against these tests silently not running.
 *
 * A skipped suite still reports green, which is precisely how an unverified
 * invariant reaches production. In CI the database is mandatory.
 */
describe("integration test wiring", () => {
  it("has a database in CI", () => {
    if (process.env.CI) {
      expect(
        hasTestDb,
        "TEST_DATABASE_URL must be set in CI, or the ledger invariant goes unverified",
      ).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });
});
