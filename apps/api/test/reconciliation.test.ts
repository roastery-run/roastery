import { greenLots, inventoryReconciliations, roastedLots } from "@roastery/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { WorkerDb } from "../src/lib/db/db";
import type { OrgDb } from "../src/lib/db/org-db";
import { scanAlerts } from "../src/lib/domain/alerts";
import { kg } from "../src/lib/domain/inventory";
import { findDrift, reconcileOrg } from "../src/lib/domain/reconciliation";
import { applyRoastedTransaction } from "../src/lib/domain/roasted";
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
 * The safety net under the ledger.
 *
 * Two modules assert that the invariant "is enforced by review plus the
 * reconciliation job". This is the job. What it must do is notice a cached
 * weight that no longer matches its ledger, say so once, and change nothing —
 * a job that repairs the number destroys the evidence of whatever wrote it.
 *
 * Drift is provoked by writing the column directly, which is exactly the class
 * of bug the job exists to catch.
 */
describe.skipIf(!hasTestDb)("reconciliation", () => {
  let db: WorkerDb;
  let close: () => Promise<void>;
  const orgs: string[] = [];
  let scoped: OrgDb;
  let warehouse: string;

  beforeAll(async () => {
    ({ db, close } = connect());
  });

  beforeEach(async () => {
    const orgId = await createTestOrg(db);
    orgs.push(orgId);
    scoped = orgDb(db, orgId);
    warehouse = await createTestLocation(db, orgId, "WH");
  });

  afterAll(async () => {
    for (const orgId of orgs) await dropTestOrg(db, orgId);
    await close?.();
  });

  function openRows() {
    return scoped.query(async (t, scope) =>
      t
        .select()
        .from(inventoryReconciliations)
        .where(and(scope(inventoryReconciliations), isNull(inventoryReconciliations.resolvedAt))),
    );
  }

  it("finds nothing when every balance matches its ledger", async () => {
    await seedLot(scoped, { lotCode: "OK-1", weightKg: "25.0000", locationId: warehouse });
    expect(await findDrift(scoped)).toEqual([]);
    expect(await reconcileOrg(scoped)).toEqual({ found: 0, recorded: 0 });
  });

  it("catches a balance written outside the ledger, and does not repair it", async () => {
    const lotId = await seedLot(scoped, {
      lotCode: "DRIFT-1",
      weightKg: "25.0000",
      locationId: warehouse,
    });

    // The bug this exists for: a column write that skipped
    // applyInventoryTransaction entirely.
    await scoped.update(greenLots, { currentWeightKg: "30.0000" }, eq(greenLots.id, lotId));

    const found = await findDrift(scoped);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "green_ledger", greenLotId: lotId });
    expect(kg.normalize(found[0]?.driftKg ?? "0")).toBe("5.0000");

    await reconcileOrg(scoped);

    const rows = await openRows();
    expect(rows).toHaveLength(1);
    expect(kg.normalize(rows[0]?.driftKg ?? "0")).toBe("5.0000");

    // Recorded, never corrected: the wrong number is the evidence.
    const [lot] = await scoped.query(async (t, scope) =>
      t
        .select({ w: greenLots.currentWeightKg })
        .from(greenLots)
        .where(and(scope(greenLots), eq(greenLots.id, lotId)))
        .limit(1),
    );
    expect(kg.normalize(lot?.w ?? "0")).toBe("30.0000");
  });

  it("reports unresolved drift once, not once a night", async () => {
    const lotId = await seedLot(scoped, {
      lotCode: "DRIFT-2",
      weightKg: "10.0000",
      locationId: warehouse,
    });
    await scoped.update(greenLots, { currentWeightKg: "11.0000" }, eq(greenLots.id, lotId));

    expect((await reconcileOrg(scoped)).recorded).toBe(1);
    // Three more nights. An open report that repeats daily is one somebody
    // mutes, which is how the next real one gets missed.
    expect((await reconcileOrg(scoped)).recorded).toBe(0);
    expect((await reconcileOrg(scoped)).recorded).toBe(0);
    expect(await openRows()).toHaveLength(1);
  });

  it("reports again once the previous report is resolved", async () => {
    const lotId = await seedLot(scoped, {
      lotCode: "DRIFT-3",
      weightKg: "10.0000",
      locationId: warehouse,
    });
    await scoped.update(greenLots, { currentWeightKg: "12.0000" }, eq(greenLots.id, lotId));
    await reconcileOrg(scoped);

    await scoped.update(
      inventoryReconciliations,
      { resolvedAt: new Date() },
      isNull(inventoryReconciliations.resolvedAt),
    );

    // Still drifting, and nobody fixed the cause: say so again.
    expect((await reconcileOrg(scoped)).recorded).toBe(1);
    expect(await openRows()).toHaveLength(1);
  });

  it("catches a reservation that no open allocation justifies", async () => {
    // The reservation counter has no ledger of its own, so this comparison
    // against open allocation rows is the only thing that can see a lost
    // update to it.
    //
    // Built the way production builds one — at zero, then a ledger row — so
    // the only drift present is the reservation. A lot inserted straight at
    // its weight also reports `roasted_ledger` drift, correctly: a balance
    // with no ledger behind it is exactly what this job is looking for.
    const [lot] = await scoped.insert(roastedLots, {
      name: "Roasted",
      lotCode: "RL-DRIFT",
      initialWeightKg: "20.0000",
      currentWeightKg: "0",
    });
    if (!lot) throw new Error("no lot");
    await applyRoastedTransaction(scoped, {
      roastedLotId: lot.id,
      eventType: "receive",
      deltaKg: "20.0000",
    });
    expect(await findDrift(scoped)).toEqual([]);

    await scoped.update(roastedLots, { reservedWeightKg: "8.0000" }, eq(roastedLots.id, lot.id));

    const found = await findDrift(scoped);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "roasted_reservation", roastedLotId: lot.id });
    expect(kg.normalize(found[0]?.driftKg ?? "0")).toBe("8.0000");
  });

  it("treats a roasted balance with no ledger behind it as drift", async () => {
    const [lot] = await scoped.insert(roastedLots, {
      name: "Roasted",
      lotCode: "RL-NOLEDGER",
      initialWeightKg: "12.0000",
      currentWeightKg: "12.0000",
    });
    if (!lot) throw new Error("no lot");

    const found = await findDrift(scoped);
    expect(found.map((d) => d.kind)).toEqual(["roasted_ledger"]);
    expect(kg.normalize(found[0]?.driftKg ?? "0")).toBe("12.0000");
  });

  it("catches a green reservation its ledger does not account for", async () => {
    // Before the reservation ledger existed this was the one cached weight
    // with nothing to check it against. A counter moved outside
    // `adjustReservation` is exactly the bug it now catches.
    const lotId = await seedLot(scoped, {
      lotCode: "RES-DRIFT",
      weightKg: "20.0000",
      locationId: warehouse,
    });
    await scoped.update(greenLots, { reservedWeightKg: "6.0000" }, eq(greenLots.id, lotId));

    const found = await findDrift(scoped);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "green_reservation", greenLotId: lotId });
    expect(kg.normalize(found[0]?.driftKg ?? "0")).toBe("6.0000");
  });

  it("finds no drift for a reservation made the normal way", async () => {
    const lotId = await seedLot(scoped, {
      lotCode: "RES-OK",
      weightKg: "20.0000",
      locationId: warehouse,
    });
    const { adjustReservation } = await import("../src/lib/domain/inventory");
    await scoped.transaction((tx) => adjustReservation(tx, lotId, "6.0000"));

    expect(await findDrift(scoped)).toEqual([]);
  });

  it("surfaces recorded drift in the daily digest as critical", async () => {
    const lotId = await seedLot(scoped, {
      lotCode: "DRIFT-4",
      weightKg: "10.0000",
      locationId: warehouse,
    });
    await scoped.update(greenLots, { currentWeightKg: "9.0000" }, eq(greenLots.id, lotId));
    await reconcileOrg(scoped);

    const alerts = await scanAlerts(scoped);
    const drift = alerts.filter((a) => a.ruleId === "inventory.ledger.drift");
    expect(drift).toHaveLength(1);
    expect(drift[0]?.severity).toBe("critical");
  });
});
