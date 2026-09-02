/**
 * Café intelligence: sites, bar equipment, espresso shots and their rollups.
 *
 * Shots are the opposite shape from roast curves. A roast is a session — 600
 * to 1,800 samples of one event, watched live — so it lives in a Durable
 * Object and is stored as a compressed curve. A shot is an EVENT: 28 seconds,
 * already over before anyone looks, but there are millions of them. So the
 * scalars are indexed columns, volume is handled by partitioning, and the
 * dashboard reads a rollup rather than the rows.
 */
import {
  boolean,
  customType,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./catalog";
import { cafeMachineKindEnum, posReconciliationStatusEnum, shotVerdictEnum } from "./enums";
import { locations, organizations } from "./org";
import { blends, roastedLots } from "./roasted";

/**
 * Postgres `bytea`, for the optional per-shot pressure/flow profile.
 *
 * Typed as Uint8Array on both sides rather than Buffer: this schema is
 * imported by packages that compile for the Workers runtime, where Node's
 * Buffer type is not in scope.
 */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => "bytea",
});

export const cafeSites = pgTable(
  "cafe_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    timezone: text("timezone"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cafe_sites_org_code_idx").on(t.orgId, t.code),
    index("cafe_sites_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

export const cafeMachines = pgTable(
  "cafe_machines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => cafeSites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    kind: cafeMachineKindEnum("kind").notNull(),
    /** Espresso machines only. Each group head is judged separately. */
    groupCount: integer("group_count"),
    brand: text("brand"),
    model: text("model"),
    /** The identifier the bar's bridge reports itself as. */
    deviceId: text("device_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cafe_machines_org_code_idx").on(t.orgId, t.code),
    index("cafe_machines_site_idx").on(t.siteId, t.kind),
    index("cafe_machines_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

/**
 * One espresso shot.
 *
 * RANGE PARTITIONED on `pulled_at`, monthly — see the hand-written migration,
 * because drizzle-kit cannot express `PARTITION BY`. A fifty-machine chain
 * produces roughly fifteen million rows a year, and partitioning is what keeps
 * "last week at this site" from scanning all of them and what makes retention
 * a `DROP TABLE` rather than a `DELETE` that has to be vacuumed.
 *
 * `espresso_shots.columns.test.ts` asserts this definition and that migration
 * describe the same columns, so the two cannot drift.
 */
export const espressoShots = pgTable(
  "espresso_shots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id").notNull(),
    machineId: uuid("machine_id").notNull(),
    /** Which group head. A single bad group is the most common real fault. */
    groupNumber: integer("group_number").notNull().default(1),

    /**
     * The bar bridge's own id for this shot.
     *
     * The dedupe key. A bridge that loses its uplink replays its buffer, and
     * without this a reconnect would double every shot in the report — the
     * quiet failure that makes a café dashboard untrustworthy.
     */
    externalId: text("external_id").notNull(),

    pulledAt: timestamp("pulled_at", { withTimezone: true }).notNull(),

    /**
     * Grams, not kilograms.
     *
     * Everything else in this system is canonical kilograms, and this is the
     * deliberate exception: a barista reads 18.5 g off a scale, and forcing
     * 0.0185 kg into a bar UI is a self-inflicted wound.
     */
    doseG: numeric("dose_g", { precision: 8, scale: 2 }),
    yieldG: numeric("yield_g", { precision: 8, scale: 2 }),
    durationS: numeric("duration_s", { precision: 8, scale: 2 }),
    brewTempC: numeric("brew_temp_c", { precision: 6, scale: 2 }),
    peakPressureBar: numeric("peak_pressure_bar", { precision: 5, scale: 2 }),
    grindSetting: text("grind_setting"),

    /** Judged at write time against the spec in force then; never re-derived. */
    verdict: shotVerdictEnum("verdict").notNull().default("in_spec"),
    /** yield / dose. The number a barista actually dials on. */
    ratio: numeric("ratio", { precision: 6, scale: 3 }),

    /** What was in the hopper, when the bar knows. */
    roastedLotId: uuid("roasted_lot_id").references(() => roastedLots.id, {
      onDelete: "set null",
    }),
    blendId: uuid("blend_id").references(() => blends.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    baristaRef: text("barista_ref"),

    /**
     * Optional pressure/flow profile, gzipped Float32.
     *
     * On the same row rather than in a sibling table: it is null for most
     * shots, TOAST moves it out of line when present, and a separate table
     * would add a join to every detail read to save nothing.
     */
    profile: bytea("profile"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * The dedupe guard, and why `pulled_at` is in it.
     *
     * A unique constraint on a partitioned table must contain the partition
     * key — Postgres has no way to enforce uniqueness across partitions
     * otherwise. That is not a compromise here: a replayed shot carries its
     * original timestamp, so it lands in the same partition and collides
     * exactly as intended.
     */
    unique("espresso_shots_dedupe_idx").on(t.orgId, t.machineId, t.externalId, t.pulledAt),
    index("espresso_shots_site_pulled_idx").on(t.orgId, t.siteId, t.pulledAt),
    index("espresso_shots_machine_pulled_idx").on(t.orgId, t.machineId, t.pulledAt),
    index("espresso_shots_verdict_idx").on(t.orgId, t.verdict, t.pulledAt),
  ],
);

/**
 * Hourly rollups.
 *
 * Every café dashboard reads these, never the shots. An hour is the right
 * grain: fine enough to see the morning rush turn bad, coarse enough that a
 * year of a fifty-machine chain is a few hundred thousand rows.
 */
export const shotRollupsHourly = pgTable(
  "shot_rollups_hourly",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => cafeSites.id, { onDelete: "cascade" }),
    machineId: uuid("machine_id")
      .notNull()
      .references(() => cafeMachines.id, { onDelete: "cascade" }),
    hourStart: timestamp("hour_start", { withTimezone: true }).notNull(),

    shotCount: integer("shot_count").notNull().default(0),
    inSpecCount: integer("in_spec_count").notNull().default(0),
    channelingCount: integer("channeling_count").notNull().default(0),
    discardedCount: integer("discarded_count").notNull().default(0),

    avgDoseG: numeric("avg_dose_g", { precision: 8, scale: 2 }),
    avgYieldG: numeric("avg_yield_g", { precision: 8, scale: 2 }),
    avgDurationS: numeric("avg_duration_s", { precision: 8, scale: 2 }),
    avgRatio: numeric("avg_ratio", { precision: 6, scale: 3 }),
    /** Consistency, which is what actually distinguishes a good bar. */
    stddevDurationS: numeric("stddev_duration_s", { precision: 8, scale: 3 }),

    coffeeUsedKg: numeric("coffee_used_kg", { precision: 14, scale: 4 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shot_rollups_hourly_key_idx").on(t.orgId, t.machineId, t.hourStart),
    index("shot_rollups_hourly_site_idx").on(t.orgId, t.siteId, t.hourStart),
  ],
);

/**
 * Sales lines pulled from a point-of-sale system, for reconciliation.
 *
 * Kept separate from shots because they are different observations of the same
 * event and the difference between them is the finding: a sale with no shot is
 * a till error or a machine that stopped reporting, and a shot with no sale is
 * either waste or theft. Merging them would erase the question.
 */
export const posTransactions = pgTable(
  "pos_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => cafeSites.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    soldAt: timestamp("sold_at", { withTimezone: true }).notNull(),
    itemName: text("item_name").notNull(),
    /** How many espresso shots this line implies. A double is two. */
    shotEquivalents: integer("shot_equivalents").notNull().default(1),
    quantity: integer("quantity").notNull().default(1),
    grossAmount: numeric("gross_amount", { precision: 18, scale: 4 }),
    currency: text("currency"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pos_transactions_external_idx").on(t.orgId, t.siteId, t.externalId),
    index("pos_transactions_site_sold_idx").on(t.orgId, t.siteId, t.soldAt),
    index("pos_transactions_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

export const posReconciliations = pgTable(
  "pos_reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    siteId: uuid("site_id")
      .notNull()
      .references(() => cafeSites.id, { onDelete: "cascade" }),
    /** The day reconciled, in the site's own timezone. */
    businessDate: text("business_date").notNull(),
    status: posReconciliationStatusEnum("status").notNull().default("pending"),

    shotCount: integer("shot_count").notNull().default(0),
    saleShotEquivalents: integer("sale_shot_equivalents").notNull().default(0),
    /** shots − sales. Positive is unsold coffee; negative is unreported shots. */
    variance: integer("variance").notNull().default(0),
    variancePct: numeric("variance_pct", { precision: 7, scale: 3 }),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pos_reconciliations_key_idx").on(t.orgId, t.siteId, t.businessDate),
    index("pos_reconciliations_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);
