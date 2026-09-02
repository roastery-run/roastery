/**
 * Roasted inventory and blends.
 *
 * Roasted lots follow the SAME ledger discipline as green: append-only
 * transactions, a cached balance moved only by them, and a per-lot sequence as
 * the concurrency guard. Two ledgers rather than one table because the two
 * sides differ in what they carry — green has provenance, harvest year and a
 * landed cost; roasted has a roast date, a freshness window and the batch that
 * made it — and a shared table would give each a column set that is mostly
 * inapplicable.
 *
 * Blends separate RECIPE from INSTANCE, which is the distinction that makes
 * "we shipped a blend that was 3% off spec" a queryable fact:
 *
 *   blends + blend_components  the recipe: target ratios, reused across
 *                              hundreds of productions and never mutated to
 *                              match what actually happened.
 *   roasted_lots (kind=blended) an instance: what was really produced.
 *   lot_consumption            the actual weights that went in, which always
 *                              drift from target because you had 4 kg less of
 *                              the Ethiopian than the recipe wanted.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { blendTypeEnum, inventoryEventEnum, lotStatusEnum, roastedLotKindEnum } from "./enums";
import { greenLots } from "./inventory";
import { locations, organizations } from "./org";
import { roastBatches } from "./production";

export const blends = pgTable(
  "blends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    blendType: blendTypeEnum("blend_type").notNull(),
    /** Expected roast loss, for planning how much green a blend needs. */
    targetWeightLossPct: numeric("target_weight_loss_pct", { precision: 5, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("blends_org_code_idx").on(t.orgId, t.code),
    index("blends_org_type_active_idx").on(t.orgId, t.blendType, t.isActive),
    index("blends_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

export const blendComponents = pgTable(
  "blend_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    blendId: uuid("blend_id")
      .notNull()
      .references(() => blends.id, { onDelete: "cascade" }),
    /** A pre-roast component is green; a post-roast component is roasted. */
    greenLotId: uuid("green_lot_id").references(() => greenLots.id, { onDelete: "restrict" }),
    roastedLotId: uuid("roasted_lot_id"),
    targetRatioPct: numeric("target_ratio_pct", { precision: 7, scale: 4 }).notNull(),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("blend_components_blend_position_idx").on(t.blendId, t.position),
    index("blend_components_green_idx").on(t.greenLotId),
    index("blend_components_roasted_idx").on(t.roastedLotId),
    // Exactly one source. A component that is neither, or both, is a recipe
    // nobody can produce — better refused by the database than discovered on
    // the roasting floor.
    check("blend_component_one_source", sql`num_nonnulls(green_lot_id, roasted_lot_id) = 1`),
  ],
);

export const roastedLots = pgTable(
  "roasted_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    lotCode: text("lot_code").notNull(),
    lotKind: roastedLotKindEnum("lot_kind").notNull().default("loose"),
    /** Set when this lot IS a produced blend — the instance of a recipe. */
    blendId: uuid("blend_id").references(() => blends.id, { onDelete: "set null" }),
    /** The batch that produced it. Null for a post-roast blend of several. */
    roastBatchId: uuid("roast_batch_id").references(() => roastBatches.id, {
      onDelete: "set null",
    }),
    roastLevel: text("roast_level"),
    agtron: numeric("agtron", { precision: 6, scale: 2 }),

    initialWeightKg: numeric("initial_weight_kg", { precision: 14, scale: 4 }).notNull(),
    /** Written ONLY by applyRoastedTransaction. */
    currentWeightKg: numeric("current_weight_kg", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    reservedWeightKg: numeric("reserved_weight_kg", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),

    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    roastedAt: timestamp("roasted_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Freshness. Roasted coffee has a usable window measured in weeks, so
     * allocation is FEFO — earliest expiry first — rather than FIFO.
     */
    bestBeforeAt: timestamp("best_before_at", { withTimezone: true }),
    unitCostBase: numeric("unit_cost_base", { precision: 18, scale: 6 }),
    status: lotStatusEnum("status").notNull().default("available"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roasted_lots_org_code_idx").on(t.orgId, t.lotCode),
    index("roasted_lots_org_status_roasted_idx").on(t.orgId, t.status, t.roastedAt),
    // Freshness-first allocation, and the "what is about to go stale" screen.
    index("roasted_lots_org_best_before_idx").on(t.orgId, t.bestBeforeAt),
    index("roasted_lots_org_blend_idx").on(t.orgId, t.blendId),
    index("roasted_lots_org_batch_idx").on(t.orgId, t.roastBatchId),
    index("roasted_lots_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

export const roastedLotTransactions = pgTable(
  "roasted_lot_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    roastedLotId: uuid("roasted_lot_id")
      .notNull()
      .references(() => roastedLots.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    eventType: inventoryEventEnum("event_type").notNull(),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    weightBeforeKg: numeric("weight_before_kg", { precision: 14, scale: 4 }).notNull(),
    deltaKg: numeric("delta_kg", { precision: 14, scale: 4 }).notNull(),
    weightAfterKg: numeric("weight_after_kg", { precision: 14, scale: 4 }).notNull(),
    groupId: uuid("group_id"),
    orderLineId: uuid("order_line_id"),
    comment: text("comment"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roasted_txn_lot_seq_idx").on(t.roastedLotId, t.seq),
    index("roasted_txn_org_lot_time_idx").on(t.orgId, t.roastedLotId, t.occurredAt),
    index("roasted_txn_org_event_idx").on(t.orgId, t.eventType, t.occurredAt),
  ],
);
