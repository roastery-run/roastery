import { contractMilestones, contracts, greenLots, partners } from "@roastery/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkerDb } from "../src/lib/db/db";
import type { OrgDb } from "../src/lib/db/org-db";
import { recordNewAlerts, scanAlerts } from "../src/lib/domain/alerts";
import { connect, createTestOrg, dropTestOrg, hasTestDb, orgDb, seedLot } from "./helpers/db";

/**
 * Alert dedupe.
 *
 * The failure mode of an alerting system is not missing an alert — it is
 * sending the same one every morning until someone mutes the channel, after
 * which it misses everything. So the property that matters is: a second scan
 * on the same day finds the same problems and sends NOTHING.
 */
describe.skipIf(!hasTestDb)("alert scan", () => {
  let db: WorkerDb;
  let close: () => Promise<void>;
  let orgId: string;
  let scoped: OrgDb;

  beforeAll(async () => {
    ({ db, close } = connect());
    orgId = await createTestOrg(db);
    scoped = orgDb(db, orgId);
  });

  afterAll(async () => {
    if (orgId) await dropTestOrg(db, orgId);
    await close?.();
  });

  it("reports an overdue milestone as critical and a due-soon one as a warning", async () => {
    const [partner] = await db
      .insert(partners)
      .values({ orgId, name: "Test Supplier", code: `SUP-${Date.now()}`, types: ["supplier"] })
      .returning();
    if (!partner) throw new Error("Failed to seed partner");

    const [contract] = await db
      .insert(contracts)
      .values({ orgId, contractNumber: `CT-${Date.now()}`, partnerId: partner.id })
      .returning();
    if (!contract) throw new Error("Failed to seed contract");

    await db.insert(contractMilestones).values([
      {
        orgId,
        contractId: contract.id,
        kind: "fixation",
        dueAt: new Date(Date.now() - 86_400_000),
      },
      {
        orgId,
        contractId: contract.id,
        kind: "vessel_arrival",
        dueAt: new Date(Date.now() + 3 * 86_400_000),
      },
    ]);

    const alerts = await scanAlerts(scoped);
    const overdue = alerts.find((a) => a.ruleId === "contract.milestone.overdue");
    const soon = alerts.find((a) => a.ruleId === "contract.milestone.due_soon");

    // Overdue is critical because the cost is asymmetric: a missed fixation is
    // expensive and recoverable only if noticed quickly.
    expect(overdue?.severity).toBe("critical");
    expect(soon?.severity).toBe("warning");
  });

  it("flags a green lot at or below its minimum", async () => {
    const lot = await seedLot(scoped, { lotCode: `LOW-${Date.now()}`, weightKg: "100" });
    await db.update(greenLots).set({ minWeightKg: "500" }).where(eq(greenLots.id, lot));

    const alerts = await scanAlerts(scoped);
    expect(
      alerts.some((a) => a.ruleId === "inventory.green.below_minimum" && a.subjectId === lot),
    ).toBe(true);
  });

  it("sends each alert once per day, however many times the scan runs", async () => {
    const first = await scanAlerts(scoped);
    expect(first.length).toBeGreaterThan(0);

    const newOnFirstRun = await recordNewAlerts(scoped, first);
    expect(newOnFirstRun.length).toBe(first.length);

    // The same problems are still there — that is the point. What must not
    // happen is sending them again.
    const second = await scanAlerts(scoped);
    expect(second.length).toBe(first.length);

    const newOnSecondRun = await recordNewAlerts(scoped, second);
    expect(
      newOnSecondRun,
      "A second scan on the same day must send nothing, or the channel gets muted",
    ).toEqual([]);
  });

  it("dedupes even when two scans race", async () => {
    const alerts = await scanAlerts(scoped);
    // Insert-and-ignore rather than select-then-insert: two concurrent scans
    // would both pass a read check and both send.
    const [a, b] = await Promise.all([
      recordNewAlerts(scoped, alerts),
      recordNewAlerts(scoped, alerts),
    ]);
    expect(a.length + b.length).toBe(0);
  });
});
