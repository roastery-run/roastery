/**
 * Green coffee inventory: the structural core of the product.
 *
 * Two decisions here are load-bearing and everything downstream depends on
 * them, so they are stated once, in full:
 *
 * WEIGHTS ARE EXACT DECIMALS IN KILOGRAMS. numeric(14,4), never float. The
 * whole auditability argument rests on SUM(delta_kg) equalling the recorded
 * balance, and float SUM is neither exact nor deterministic under parallel
 * aggregation. 10 integer digits spans a 40-tonne container; 4 decimal places
 * resolves a 20 g sample roast.
 *
 * THE LEDGER IS TRUTH; THE BALANCE IS A CACHE. Deriving the balance on every
 * read is correct but unusable — the lot list is the most-loaded screen in the
 * product and would be O(transactions) per row. Storing only the balance is
 * fast and loses the audit trail a coffee business is legally built on. So
 * both, with a single write path (lib/inventory.ts) that updates them in one
 * transaction, a per-lot monotonic sequence to serialize writers, and a
 * reconciliation job that ALERTS on drift rather than silently correcting it —
 * silent correction hides the bug that caused the drift.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
import { partners, producers } from "./catalog";
import {
  costComponentKindEnum,
  greenStateEnum,
  inventoryEventEnum,
  lotStatusEnum,
  traceNodeKindEnum,
} from "./enums";
import { locations, organizations, unitsOfMeasure } from "./org";

export const greenLots = pgTable(
  "green_lots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    lotCode: text("lot_code").notNull(),
    /** The supplier's own reference, for reconciling against their paperwork. */
    supplierRef: text("supplier_ref"),
    producerId: uuid("producer_id").references(() => producers.id, { onDelete: "set null" }),
    partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "set null" }),
    /** Set when this lot came from splitting another. */
    parentLotId: uuid("parent_lot_id"),

    state: greenStateEnum("state").notNull().default("green"),
    status: lotStatusEnum("status").notNull().default("available"),
    varieties: text("varieties").array().notNull().default(sql`'{}'`),
    processMethod: text("process_method"),
    harvestYear: integer("harvest_year"),
    certifications: text("certifications").array().notNull().default(sql`'{}'`),

    /* --- weights, all canonical kilograms --- */
    initialWeightKg: numeric("initial_weight_kg", { precision: 14, scale: 4 }).notNull(),
    /**
     * Denormalized balance. Written ONLY by applyInventoryTransaction, in the
     * same transaction as the ledger row it follows from.
     */
    currentWeightKg: numeric("current_weight_kg", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    /** Committed to orders or production but not yet consumed. */
    reservedWeightKg: numeric("reserved_weight_kg", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    minWeightKg: numeric("min_weight_kg", { precision: 14, scale: 4 }),

    /**
     * What the user actually typed, and in what unit.
     *
     * Without this "275 bags" renders forever as "18,975.0000 kg" and the
     * trader stops trusting the screen.
     */
    enteredValue: numeric("entered_value", { precision: 14, scale: 4 }),
    enteredUnitId: uuid("entered_unit_id").references(() => unitsOfMeasure.id, {
      onDelete: "set null",
    }),
    /**
     * Bags are NOT a mass unit: a 69 kg Colombian bag and a 60 kg Brazilian
     * bag are both "bags", so the conversion lives per lot rather than on a
     * global unit definition.
     */
    bagCount: integer("bag_count"),
    bagWeightKg: numeric("bag_weight_kg", { precision: 10, scale: 4 }),

    /* --- money --- */
    /** Unit prices carry 6 decimals: differentials quote to 4+ on a $/lb basis. */
    unitCost: numeric("unit_cost", { precision: 18, scale: 6 }),
    costUnitId: uuid("cost_unit_id").references(() => unitsOfMeasure.id, { onDelete: "set null" }),
    currency: text("currency"),
    /** Converted at write time, so reports never re-derive historical FX. */
    totalValueBase: numeric("total_value_base", { precision: 18, scale: 4 }),
    fxRateUsed: numeric("fx_rate_used", { precision: 18, scale: 8 }),

    defaultLocationId: uuid("default_location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("green_lots_org_code_idx").on(t.orgId, t.lotCode),
    // The main inventory grid, and the "what is running low" filter.
    index("green_lots_org_status_weight_idx").on(t.orgId, t.status, t.currentWeightKg),
    index("green_lots_org_registered_idx").on(t.orgId, t.registeredAt),
    index("green_lots_org_producer_idx").on(t.orgId, t.producerId),
    index("green_lots_org_parent_idx").on(t.orgId, t.parentLotId),
    index("green_lots_org_created_idx").on(t.orgId, t.createdAt, t.id),
    index("green_lots_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

/**
 * The append-only ledger. Every gram that moves leaves a row here.
 *
 * Each row records the balance before and after, not just the delta, so any
 * single row is independently auditable without replaying the whole history —
 * which is what an auditor actually asks for.
 */
export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    greenLotId: uuid("green_lot_id")
      .notNull()
      .references(() => greenLots.id, { onDelete: "cascade" }),
    /**
     * Per-lot monotonic sequence.
     *
     * This is the concurrency guard, not decoration: two writers computing the
     * same next value collide on the unique index below, and the loser retries
     * against the new balance instead of overwriting it.
     */
    seq: bigint("seq", { mode: "number" }).notNull(),

    eventType: inventoryEventEnum("event_type").notNull(),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),

    weightBeforeKg: numeric("weight_before_kg", { precision: 14, scale: 4 }).notNull(),
    /** Negative removes. */
    deltaKg: numeric("delta_kg", { precision: 14, scale: 4 }).notNull(),
    weightAfterKg: numeric("weight_after_kg", { precision: 14, scale: 4 }).notNull(),

    /** Links the two halves of a transfer, split or merge. */
    groupId: uuid("group_id"),
    counterpartyLotId: uuid("counterparty_lot_id"),
    roastBatchId: uuid("roast_batch_id"),
    contractLineId: uuid("contract_line_id"),

    comment: text("comment"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The concurrency guard.
    uniqueIndex("inventory_txn_lot_seq_idx").on(t.greenLotId, t.seq),
    // Lot transaction history: the highest-volume read in the module.
    index("inventory_txn_org_lot_time_idx").on(t.orgId, t.greenLotId, t.occurredAt),
    index("inventory_txn_org_event_time_idx").on(t.orgId, t.eventType, t.occurredAt),
    index("inventory_txn_org_location_idx").on(t.orgId, t.locationId, t.occurredAt),
    index("inventory_txn_group_idx").on(t.groupId),
    index("inventory_txn_roast_idx").on(t.roastBatchId),
  ],
);

/**
 * Where a lot physically is.
 *
 * Derived from the ledger in principle, cached here in practice: "how much of
 * this lot is at the Oakland warehouse" is a first-class question, and
 * answering it by scanning the ledger per location is the same O(n) problem
 * the balance cache exists to avoid.
 */
/**
 * Every change to a green lot's reservation, append-only.
 *
 * The balance has a ledger and can always be recomputed from it; the
 * reservation counter had nothing, so a lost update to it was undetectable
 * rather than merely wrong — the one weight in the system with no way to check
 * itself. Roasted reservations were already derivable from open `allocations`
 * rows, which is what the reconciliation job compares them against. This gives
 * green lots the same property.
 *
 * Same shape as `inventory_transactions` and for the same reasons: a monotonic
 * per-lot `seq` with a unique index, so two concurrent writers cannot both
 * claim the same position, and before/delta/after on every row, so any single
 * row is independently auditable.
 */
export const greenLotReservations = pgTable(
  "green_lot_reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    greenLotId: uuid("green_lot_id")
      .notNull()
      .references(() => greenLots.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    /** Positive commits weight to work; negative releases it. */
    deltaKg: numeric("delta_kg", { precision: 14, scale: 4 }).notNull(),
    reservedBeforeKg: numeric("reserved_before_kg", { precision: 14, scale: 4 }).notNull(),
    reservedAfterKg: numeric("reserved_after_kg", { precision: 14, scale: 4 }).notNull(),
    reason: text("reason"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The concurrency guard, exactly as on the inventory ledger.
    uniqueIndex("green_lot_reservations_lot_seq_idx").on(t.greenLotId, t.seq),
    index("green_lot_reservations_org_lot_idx").on(t.orgId, t.greenLotId, t.createdAt),
  ],
);

export const lotLocationBalances = pgTable(
  "lot_location_balances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    greenLotId: uuid("green_lot_id")
      .notNull()
      .references(() => greenLots.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    weightKg: numeric("weight_kg", { precision: 14, scale: 4 }).notNull().default("0"),
    bagCount: integer("bag_count"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lot_location_balances_lot_loc_idx").on(t.greenLotId, t.locationId),
    index("lot_location_balances_org_loc_idx").on(t.orgId, t.locationId),
  ],
);

/**
 * The traceability graph, as edges.
 *
 * One polymorphic edge table rather than a self-referencing FK, because a
 * self-FK cannot express a MERGE (N sources, one target) — and merges are
 * routine. Rather than a closure table, because coffee lineage is shallow
 * (~8 hops, capped) and traversed rarely: paying write amplification on every
 * roast to speed up a query run a few times a day is the wrong trade.
 *
 * The accepted cost is that sourceId/targetId carry no foreign keys — a
 * genuine 7-type polymorphic edge cannot. Integrity comes from a single write
 * path, a periodic orphan scan, and the orgId cascade.
 */
export const lotConsumption = pgTable(
  "lot_consumption",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sourceKind: traceNodeKindEnum("source_kind").notNull(),
    sourceId: uuid("source_id").notNull(),
    targetKind: traceNodeKindEnum("target_kind").notNull(),
    targetId: uuid("target_id").notNull(),
    weightKg: numeric("weight_kg", { precision: 14, scale: 4 }).notNull(),
    /** Actual contribution; drifts from a blend's target ratio, deliberately. */
    ratioPct: numeric("ratio_pct", { precision: 7, scale: 4 }),
    transactionId: uuid("transaction_id").references(() => inventoryTransactions.id, {
      onDelete: "set null",
    }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Both traversal directions of the recursive CTE, so forward tracing and
    // recall scoping are equally index-driven.
    index("lot_consumption_src_idx").on(t.orgId, t.sourceKind, t.sourceId),
    index("lot_consumption_tgt_idx").on(t.orgId, t.targetKind, t.targetId),
    index("lot_consumption_txn_idx").on(t.transactionId),
  ],
);

/**
 * Drift between the ledger and the cached balance.
 *
 * Rows here are an alert, not a repair. Silently correcting the balance would
 * hide whatever wrote it without a ledger row, which is the actual bug.
 */

/**
 * The costs that make up a lot's landed price.
 *
 * Held as components rather than a single number because the question a
 * roaster actually asks is "why is this coffee expensive" — and the answer is
 * freight, or the differential, or carry. Collapsing them loses the answer.
 */
export const costComponents = pgTable(
  "cost_components",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    greenLotId: uuid("green_lot_id").references(() => greenLots.id, { onDelete: "cascade" }),
    contractLineId: uuid("contract_line_id"),
    kind: costComponentKindEnum("kind").notNull(),
    label: text("label"),
    amount: numeric("amount", { precision: 18, scale: 4 }).notNull(),
    currency: text("currency").notNull(),
    fxRateUsed: numeric("fx_rate_used", { precision: 18, scale: 8 }),
    amountBase: numeric("amount_base", { precision: 18, scale: 4 }).notNull(),
    /** True when `amount` is per unit rather than a flat charge for the lot. */
    perUnit: boolean("per_unit").notNull().default(false),
    unitId: uuid("unit_id").references(() => unitsOfMeasure.id, { onDelete: "set null" }),
    incurredAt: timestamp("incurred_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cost_components_org_lot_idx").on(t.orgId, t.greenLotId),
    index("cost_components_org_line_idx").on(t.orgId, t.contractLineId),
    index("cost_components_org_kind_idx").on(t.orgId, t.kind),
  ],
);

/** The rolled-up result, recomputed whenever a component changes. */
export const landedCosts = pgTable(
  "landed_costs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    greenLotId: uuid("green_lot_id")
      .notNull()
      .references(() => greenLots.id, { onDelete: "cascade" }),
    basePriceBase: numeric("base_price_base", { precision: 18, scale: 4 }).notNull().default("0"),
    freightBase: numeric("freight_base", { precision: 18, scale: 4 }).notNull().default("0"),
    dutyBase: numeric("duty_base", { precision: 18, scale: 4 }).notNull().default("0"),
    carryBase: numeric("carry_base", { precision: 18, scale: 4 }).notNull().default("0"),
    otherBase: numeric("other_base", { precision: 18, scale: 4 }).notNull().default("0"),
    totalBase: numeric("total_base", { precision: 18, scale: 4 }).notNull().default("0"),
    /** What the roaster actually compares between lots. */
    perKgBase: numeric("per_kg_base", { precision: 18, scale: 6 }).notNull().default("0"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("landed_costs_org_lot_idx").on(t.orgId, t.greenLotId)],
);
