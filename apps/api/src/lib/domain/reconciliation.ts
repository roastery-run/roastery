/**
 * The reconciliation job: does the system still agree with itself?
 *
 * Two modules in this codebase state that the ledger invariant "is enforced by
 * review plus the reconciliation job". The review half existed. This is the
 * other half, and until it did, the invariant rested on nobody ever writing a
 * cached weight outside the transaction path — which is exactly the kind of
 * thing that holds until the day it does not, and then holds silently.
 *
 * Three checks, one per cached weight:
 *
 *   green_ledger         green_lots.current_weight_kg    vs SUM(delta_kg)
 *   roasted_ledger       roasted_lots.current_weight_kg  vs SUM(delta_kg)
 *   roasted_reservation  roasted_lots.reserved_weight_kg vs open allocations
 *   green_reservation    green_lots.reserved_weight_kg   vs SUM(delta_kg)
 *
 * The last two are the reservation counters, and they are checked differently
 * because they are justified differently: a roasted reservation is the sum of
 * the allocation rows that claim it, and a green one is the sum of its own
 * ledger. Until that ledger existed there was no way to check it at all.
 *
 * Nothing here corrects anything. Drift is recorded and alerted on, because
 * quietly fixing the number destroys the evidence of whatever produced it and
 * guarantees the next occurrence is just as invisible. The reconciliation row
 * is the bug report; a person resolves it.
 *
 * Set-based on purpose: one query per check per organization, not one per lot.
 * A per-lot loop is what turns a nightly job into something that times out on
 * the one tenant large enough to matter.
 */
import { inventoryReconciliations } from "@roastery/db/schema";
import { sql } from "drizzle-orm";
import type { OrgDb } from "../db/org-db";

export type DriftKind =
  | "green_ledger"
  | "roasted_ledger"
  | "roasted_reservation"
  | "green_reservation";

export type Drift = {
  kind: DriftKind;
  greenLotId: string | null;
  roastedLotId: string | null;
  lotCode: string;
  expectedKg: string;
  actualKg: string;
  driftKg: string;
};

/**
 * Every lot whose cached weight disagrees with its source of truth.
 *
 * The comparison is `<>` on numeric, not a tolerance: these are exact decimal
 * columns written by BigInt arithmetic, so any difference at all is a bug
 * rather than rounding. A tolerance here would hide the small persistent drift
 * that says a write path is wrong.
 */
export async function findDrift(db: OrgDb): Promise<Drift[]> {
  // unscoped-ok: this is one UNION of three aggregates, which the query
  // builder's scope() predicate cannot express. Every branch filters on
  // `org_id = db.orgId` explicitly, and every join carries the tenant across
  // (`x.org_id = l.org_id`, `a.org_id = r.org_id`) so a row from another
  // tenant cannot enter through the join either.
  const rows = await db.query(async (t) =>
    t.execute<{
      kind: DriftKind;
      green_lot_id: string | null;
      roasted_lot_id: string | null;
      lot_code: string;
      expected_kg: string;
      actual_kg: string;
      drift_kg: string;
    }>(sql`
      select 'green_ledger' as kind,
             l.id as green_lot_id,
             null::uuid as roasted_lot_id,
             l.lot_code,
             coalesce(sum(x.delta_kg), 0)::text as expected_kg,
             l.current_weight_kg::text as actual_kg,
             (l.current_weight_kg - coalesce(sum(x.delta_kg), 0))::text as drift_kg
        from green_lots l
        left join inventory_transactions x
          on x.green_lot_id = l.id and x.org_id = l.org_id
       where l.org_id = ${db.orgId}
       group by l.id, l.lot_code, l.current_weight_kg
      having l.current_weight_kg <> coalesce(sum(x.delta_kg), 0)

      union all

      select 'roasted_ledger',
             null::uuid,
             r.id,
             r.lot_code,
             coalesce(sum(x.delta_kg), 0)::text,
             r.current_weight_kg::text,
             (r.current_weight_kg - coalesce(sum(x.delta_kg), 0))::text
        from roasted_lots r
        left join roasted_lot_transactions x
          on x.roasted_lot_id = r.id and x.org_id = r.org_id
       where r.org_id = ${db.orgId}
       group by r.id, r.lot_code, r.current_weight_kg
      having r.current_weight_kg <> coalesce(sum(x.delta_kg), 0)

      union all

      -- A reservation is justified by its open allocation rows and nothing
      -- else, so this is the only check that can see a lost update to the
      -- counter.
      select 'roasted_reservation',
             null::uuid,
             r.id,
             r.lot_code,
             coalesce(sum(a.weight_kg) filter (where a.released_at is null), 0)::text,
             r.reserved_weight_kg::text,
             (r.reserved_weight_kg
               - coalesce(sum(a.weight_kg) filter (where a.released_at is null), 0))::text
        from roasted_lots r
        left join allocations a
          on a.roasted_lot_id = r.id and a.org_id = r.org_id
       where r.org_id = ${db.orgId}
       group by r.id, r.lot_code, r.reserved_weight_kg
      having r.reserved_weight_kg
             <> coalesce(sum(a.weight_kg) filter (where a.released_at is null), 0)

      union all

      select 'green_reservation',
             l.id,
             null::uuid,
             l.lot_code,
             coalesce(sum(v.delta_kg), 0)::text,
             l.reserved_weight_kg::text,
             (l.reserved_weight_kg - coalesce(sum(v.delta_kg), 0))::text
        from green_lots l
        left join green_lot_reservations v
          on v.green_lot_id = l.id and v.org_id = l.org_id
       where l.org_id = ${db.orgId}
       group by l.id, l.lot_code, l.reserved_weight_kg
      having l.reserved_weight_kg <> coalesce(sum(v.delta_kg), 0)
    `),
  );

  return [...rows].map((row) => ({
    kind: row.kind,
    greenLotId: row.green_lot_id,
    roastedLotId: row.roasted_lot_id,
    lotCode: row.lot_code,
    expectedKg: row.expected_kg,
    actualKg: row.actual_kg,
    driftKg: row.drift_kg,
  }));
}

/**
 * Records drift, once per subject, until somebody resolves it.
 *
 * Insert-and-ignore against the partial unique index rather than
 * select-then-insert: two runs overlapping both pass a read check, and only
 * one can win the insert. An unresolved row therefore stays a single row that
 * ages, rather than becoming a new row every night — the same reason the alert
 * table dedupes on (rule, subject, day).
 */
export async function recordDrift(db: OrgDb, drifts: Drift[]): Promise<number> {
  if (!drifts.length) return 0;

  // unscoped-ok: orgId is set explicitly on every row, and the conflict target
  // is the partial unique index that provides the dedupe guarantee itself.
  const inserted = await db.query(async (t) =>
    t
      .insert(inventoryReconciliations)
      .values(
        drifts.map((d) => ({
          orgId: db.orgId,
          kind: d.kind,
          greenLotId: d.greenLotId,
          roastedLotId: d.roastedLotId,
          expectedKg: d.expectedKg,
          actualKg: d.actualKg,
          driftKg: d.driftKg,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: inventoryReconciliations.id }),
  );

  return inserted.length;
}

/** Finds and records drift for one organization. */
export async function reconcileOrg(db: OrgDb): Promise<{ found: number; recorded: number }> {
  const drifts = await findDrift(db);
  const recorded = await recordDrift(db, drifts);
  return { found: drifts.length, recorded };
}
