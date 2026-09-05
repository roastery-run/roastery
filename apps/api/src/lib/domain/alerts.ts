import {
  alertNotifications,
  contractMilestones,
  greenLots,
  inventoryReconciliations,
  materials,
} from "@roastery/db/schema";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import type { OrgDb } from "../db/org-db";

/**
 * The daily alert scan.
 *
 * The failure mode of an alerting system is not missing an alert — it is
 * sending the same one every morning until someone mutes the channel, after
 * which it misses everything. So dedupe is not a refinement here, it is the
 * feature: one row per (rule, subject, day) makes a repeat send impossible
 * rather than unlikely, enforced by a unique index rather than by a check the
 * sender might skip.
 */

export type Alert = {
  ruleId: string;
  subjectId: string;
  severity: "info" | "warning" | "critical";
  message: string;
};

const OVERDUE_HORIZON_DAYS = 7;

/** Everything worth telling this organization about today. */
export async function scanAlerts(db: OrgDb): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const horizon = new Date(Date.now() + OVERDUE_HORIZON_DAYS * 86_400_000);

  const milestones = await db.query(async (t, scope) =>
    t
      .select({
        id: contractMilestones.id,
        kind: contractMilestones.kind,
        dueAt: contractMilestones.dueAt,
      })
      .from(contractMilestones)
      .where(
        and(
          scope(contractMilestones),
          isNull(contractMilestones.completedAt),
          lte(contractMilestones.dueAt, horizon),
        ),
      )
      .limit(500),
  );

  for (const m of milestones) {
    const overdue = m.dueAt !== null && m.dueAt.getTime() < Date.now();
    alerts.push({
      ruleId: overdue ? "contract.milestone.overdue" : "contract.milestone.due_soon",
      subjectId: m.id,
      // Overdue is critical because the cost is asymmetric: a missed fixation
      // or vessel is expensive and only recoverable if noticed quickly.
      severity: overdue ? "critical" : "warning",
      message: overdue
        ? `Contract milestone "${m.kind}" is overdue`
        : `Contract milestone "${m.kind}" is due within ${OVERDUE_HORIZON_DAYS} days`,
    });
  }

  const lowLots = await db.query(async (t, scope) =>
    t
      .select({ id: greenLots.id, name: greenLots.name })
      .from(greenLots)
      .where(
        and(
          scope(greenLots),
          sql`${greenLots.minWeightKg} is not null`,
          sql`${greenLots.currentWeightKg} <= ${greenLots.minWeightKg}`,
          sql`${greenLots.status} not in ('depleted', 'archived')`,
        ),
      )
      .limit(500),
  );

  for (const lot of lowLots) {
    alerts.push({
      ruleId: "inventory.green.below_minimum",
      subjectId: lot.id,
      severity: "warning",
      message: `Green lot "${lot.name}" is at or below its minimum level`,
    });
  }

  const lowMaterials = await db.query(async (t, scope) =>
    t
      .select({ id: materials.id, name: materials.name, leadTimeDays: materials.leadTimeDays })
      .from(materials)
      .where(
        and(
          scope(materials),
          eq(materials.isActive, true),
          sql`${materials.reorderPoint} is not null`,
          sql`${materials.onHandQty} <= ${materials.reorderPoint}`,
        ),
      )
      .limit(500),
  );

  for (const m of lowMaterials) {
    alerts.push({
      ruleId: "inventory.material.below_reorder",
      subjectId: m.id,
      severity: "warning",
      // The lead time is what makes this actionable rather than merely true.
      message: m.leadTimeDays
        ? `Material "${m.name}" is at its reorder point (${m.leadTimeDays} day lead time)`
        : `Material "${m.name}" is at its reorder point`,
    });
  }

  // Read from the reconciliation table rather than re-running the drift
  // queries: that table IS the record, this is only the notification, and
  // running the comparison twice invites the two to disagree about what was
  // found. The nightly job writes at 03:30 so anything it found is here by the
  // time the digest is built.
  const drifts = await db.query(async (t, scope) =>
    t
      .select({
        id: inventoryReconciliations.id,
        kind: inventoryReconciliations.kind,
        driftKg: inventoryReconciliations.driftKg,
      })
      .from(inventoryReconciliations)
      .where(and(scope(inventoryReconciliations), isNull(inventoryReconciliations.resolvedAt)))
      .limit(500),
  );

  for (const d of drifts) {
    alerts.push({
      ruleId: "inventory.ledger.drift",
      subjectId: d.id,
      // Critical, and deliberately not configurable. Drift means something
      // wrote a cached weight outside the one path allowed to, so every number
      // derived from that lot — valuations, availability, what can be promised
      // to a customer — is suspect until someone looks.
      severity: "critical",
      message:
        d.kind === "roasted_reservation"
          ? `A roasted lot's reservation is out by ${d.driftKg} kg against its open allocations`
          : `A lot's balance is out by ${d.driftKg} kg against its ledger`,
    });
  }

  return alerts;
}

/**
 * Records alerts that have not already been sent today.
 *
 * Returns only the NEW ones, so a caller can send exactly those. Dedupe is by
 * insert-and-ignore rather than select-then-insert: two scans running
 * concurrently would both pass a read check and both send.
 */
export async function recordNewAlerts(db: OrgDb, alerts: Alert[]): Promise<Alert[]> {
  if (!alerts.length) return [];
  const digestDate = new Date().toISOString().slice(0, 10);

  // unscoped-ok: orgId is set explicitly on every row below, and the conflict
  // target is the (orgId, ruleId, subjectId, digestDate) unique index — which
  // is the dedupe guarantee itself, not merely a filter.
  const inserted = await db.query(async (t) =>
    t
      .insert(alertNotifications)
      .values(
        alerts.map((a) => ({
          orgId: db.orgId,
          ruleId: a.ruleId,
          subjectId: a.subjectId,
          digestDate,
          severity: a.severity,
          payload: a.message,
        })),
      )
      // The unique index on (org, rule, subject, day) is what makes a repeat
      // send impossible; this turns the collision into a no-op rather than an
      // error, and RETURNING tells us which rows were genuinely new.
      .onConflictDoNothing()
      .returning({ ruleId: alertNotifications.ruleId, subjectId: alertNotifications.subjectId }),
  );

  const newKeys = new Set(inserted.map((r) => `${r.ruleId}:${r.subjectId}`));
  return alerts.filter((a) => newKeys.has(`${a.ruleId}:${a.subjectId}`));
}

/** Stamps alerts as sent, so a delivery failure can be retried. */
export async function markAlertsSent(db: OrgDb, alerts: Alert[]): Promise<void> {
  if (!alerts.length) return;
  const digestDate = new Date().toISOString().slice(0, 10);
  for (const a of alerts) {
    await db.update(
      alertNotifications,
      { sentAt: new Date() },
      and(
        eq(alertNotifications.ruleId, a.ruleId),
        eq(alertNotifications.subjectId, a.subjectId),
        eq(alertNotifications.digestDate, digestDate),
      ) as never,
    );
  }
}
