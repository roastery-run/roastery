/**
 * Integrity checking: where the system records that it disagreed with itself.
 *
 * Its own module because it is the only thing that has to reference BOTH lot
 * kinds, and the schema's import chain runs inventory -> roasted. Sitting at
 * the end of that chain is what lets one table cover all three cached weights
 * instead of splitting the same concern in two.
 */
import { sql } from "drizzle-orm";
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { greenLots } from "./inventory";
import { organizations } from "./org";
import { roastedLots } from "./roasted";

/**
 * Drift found between a cached weight and what its source of truth says.
 *
 * A row here is a bug report, not a correction. Silently repairing the balance
 * would erase the only evidence of whatever wrote it outside the transaction
 * path, and the next occurrence would be exactly as invisible as this one was.
 *
 * Three kinds, because there are three cached weights and they fail
 * differently. `green_ledger` and `roasted_ledger` compare a balance against
 * SUM(delta_kg) over its ledger. `roasted_reservation` compares a lot's
 * reservation counter against its open allocation rows — the only check that
 * can find a lost reservation update, since a reservation has no ledger of its
 * own to recompute from.
 *
 * Exactly one lot id is set, enforced by a CHECK rather than by the code that
 * inserts. The partial unique index means an unresolved problem stays ONE row
 * rather than becoming a new row every night: the same instinct as the alert
 * dedupe index, because a report that repeats daily is a report somebody mutes.
 */
export const inventoryReconciliations = pgTable(
  "inventory_reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("green_ledger"),
    greenLotId: uuid("green_lot_id").references(() => greenLots.id, { onDelete: "cascade" }),
    roastedLotId: uuid("roasted_lot_id").references(() => roastedLots.id, { onDelete: "cascade" }),
    /** What the ledger, or the set of open allocations, adds up to. */
    expectedKg: numeric("expected_kg", { precision: 14, scale: 4 }).notNull(),
    /** What the cached column actually held when the check ran. */
    actualKg: numeric("actual_kg", { precision: 14, scale: 4 }).notNull(),
    driftKg: numeric("drift_kg", { precision: 14, scale: 4 }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_recon_org_lot_idx").on(t.orgId, t.greenLotId, t.createdAt),
    index("inventory_recon_open_idx").on(t.orgId, t.createdAt).where(sql`resolved_at IS NULL`),
    uniqueIndex("inventory_recon_open_subject_idx")
      .on(t.orgId, sql`coalesce(${t.greenLotId}, ${t.roastedLotId})`, t.kind)
      .where(sql`resolved_at IS NULL`),
    check(
      "inventory_recon_one_subject",
      sql`(${t.greenLotId} is null) <> (${t.roastedLotId} is null)`,
    ),
  ],
);
