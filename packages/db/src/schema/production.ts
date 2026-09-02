/**
 * Roasting: profiles, batches and the curves they produce.
 *
 * THE TIME-SERIES DECISION, stated once because it shapes the whole module.
 *
 * A roast is 8–16 minutes sampled at 1–2 Hz across ~8 channels: 600–1,800
 * samples per batch. Storing one row per measurement means ~130M rows a year
 * for a modest roastery, and — the part that actually bites — 15–40 ms of
 * driver row-parsing per chart render, which is the entire CPU budget of a
 * Worker request before anything is drawn.
 *
 * So the curve is stored three ways, each for a different question:
 *
 *   curvePreview  ~120 points, struct-of-arrays JSONB, ~3 KB. For lists and
 *                 thumbnails. Struct-of-arrays rather than array-of-objects is
 *                 a ~5x size and ~3x parse win.
 *   roastSamples  1 Hz downsample in Postgres, ~900 rows per roast. Enough
 *                 resolution for every SQL question anyone actually asks:
 *                 profile-vs-actual deviation, batch comparison, DTR trends.
 *   R2 object     full fidelity, gzip-compressed columns, fetched only when
 *                 someone opens a single batch and wants everything.
 *
 * Postgres is for QUERYING; R2 is for the artifact. Putting 10 Hz raw curves
 * in Postgres would make this the largest table in the schema within a month,
 * to serve analytics nobody runs at that resolution.
 *
 * Roast EVENTS stay relational regardless of volume — there are 5–8 per batch
 * and you filter and chart on them ("every batch where DTR exceeded 22%").
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { machines } from "./catalog";
import {
  goalResultEnum,
  roastBatchStatusEnum,
  roastEventKindEnum,
  roastGoalMetricEnum,
  roastPurposeEnum,
} from "./enums";
import { greenLots } from "./inventory";
import { locations, organizations } from "./org";

export const roastProfiles = pgTable(
  "roast_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    version: integer("version").notNull().default(1),
    machineId: uuid("machine_id").references(() => machines.id, { onDelete: "set null" }),
    greenLotId: uuid("green_lot_id").references(() => greenLots.id, { onDelete: "set null" }),

    targetChargeKg: numeric("target_charge_kg", { precision: 10, scale: 4 }),
    targetDropTempC: numeric("target_drop_temp_c", { precision: 6, scale: 2 }),
    targetTotalTimeS: integer("target_total_time_s"),
    /** Development time ratio: the share of the roast after first crack. */
    targetDtrPct: numeric("target_dtr_pct", { precision: 5, scale: 2 }),

    /**
     * The curve a roaster is trying to reproduce, as a downsampled preview.
     * A reference is compared by eye against a live curve, so preview
     * resolution is the right resolution.
     */
    referenceCurve: jsonb("reference_curve").$type<{
      t: number[];
      bt: number[];
      et: number[];
      ror: number[];
    }>(),
    referenceBatchId: uuid("reference_batch_id"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roast_profiles_org_code_version_idx").on(t.orgId, t.code, t.version),
    index("roast_profiles_org_machine_idx").on(t.orgId, t.machineId, t.isActive),
    index("roast_profiles_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

export const roastBatches = pgTable(
  "roast_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    batchNumber: text("batch_number").notNull(),
    machineId: uuid("machine_id").references(() => machines.id, { onDelete: "set null" }),
    profileId: uuid("profile_id").references(() => roastProfiles.id, { onDelete: "set null" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    status: roastBatchStatusEnum("status").notNull().default("scheduled"),
    purpose: roastPurposeEnum("purpose").notNull().default("production"),
    roasterUserId: text("roaster_user_id").references(() => users.id, { onDelete: "set null" }),

    chargeWeightKg: numeric("charge_weight_kg", { precision: 12, scale: 4 }),
    dropWeightKg: numeric("drop_weight_kg", { precision: 12, scale: 4 }),
    /** Derived at completion; the headline quality number for a batch. */
    weightLossPct: numeric("weight_loss_pct", { precision: 6, scale: 3 }),

    chargeTempC: numeric("charge_temp_c", { precision: 6, scale: 2 }),
    dropTempC: numeric("drop_temp_c", { precision: 6, scale: 2 }),
    totalTimeS: integer("total_time_s"),
    dryEndS: integer("dry_end_s"),
    firstCrackS: integer("first_crack_s"),
    developmentTimeS: integer("development_time_s"),
    dtrPct: numeric("dtr_pct", { precision: 5, scale: 2 }),
    maxRorCPerMin: numeric("max_ror_c_per_min", { precision: 7, scale: 3 }),
    ambientTempC: numeric("ambient_temp_c", { precision: 6, scale: 2 }),
    ambientHumidityPct: numeric("ambient_humidity_pct", { precision: 5, scale: 2 }),

    /** ~120-point struct-of-arrays preview, for lists and the schedule board. */
    curvePreview: jsonb("curve_preview").$type<{
      t: number[];
      bt: number[];
      et: number[];
      ror: number[];
    }>(),
    /** Full-fidelity curve in R2. Postgres keeps only the downsample. */
    curveObjectKey: text("curve_object_key"),
    sampleCount: integer("sample_count"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roast_batches_org_number_idx").on(t.orgId, t.batchNumber),
    // The production log, and per-machine utilization.
    index("roast_batches_org_started_idx").on(t.orgId, t.startedAt),
    index("roast_batches_org_machine_started_idx").on(t.orgId, t.machineId, t.startedAt),
    index("roast_batches_org_profile_started_idx").on(t.orgId, t.profileId, t.startedAt),
    index("roast_batches_org_status_idx").on(t.orgId, t.status),
    index("roast_batches_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

/**
 * 1 Hz downsample of the curve.
 *
 * No org_id: a roast has hundreds of these, and denormalizing the tenant onto
 * every row costs more than the semi-join through roast_batches saves. This is
 * the canonical TENANT_VIA case.
 */
export const roastSamples = pgTable(
  "roast_samples",
  {
    batchId: uuid("batch_id")
      .notNull()
      .references(() => roastBatches.id, { onDelete: "cascade" }),
    /** Seconds since charge. Never wall-clock: machine clocks drift, and
     *  roasts are compared by elapsed time. */
    t: numeric("t", { precision: 8, scale: 2 }).notNull(),
    beanTempC: numeric("bean_temp_c", { precision: 6, scale: 2 }),
    envTempC: numeric("env_temp_c", { precision: 6, scale: 2 }),
    rorCPerMin: numeric("ror_c_per_min", { precision: 7, scale: 3 }),
    gasPct: numeric("gas_pct", { precision: 5, scale: 2 }),
    airflowPct: numeric("airflow_pct", { precision: 5, scale: 2 }),
    drumRpm: numeric("drum_rpm", { precision: 6, scale: 2 }),
  },
  (t) => [uniqueIndex("roast_samples_batch_t_idx").on(t.batchId, t.t)],
);

export const roastEvents = pgTable(
  "roast_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => roastBatches.id, { onDelete: "cascade" }),
    kind: roastEventKindEnum("kind").notNull(),
    atSeconds: numeric("at_seconds", { precision: 8, scale: 2 }).notNull(),
    beanTempC: numeric("bean_temp_c", { precision: 6, scale: 2 }),
    rorCPerMin: numeric("ror_c_per_min", { precision: 7, scale: 3 }),
    /** For gas/air/drum changes: the new setting. */
    value: numeric("value", { precision: 10, scale: 4 }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("roast_events_batch_time_idx").on(t.batchId, t.atSeconds),
    index("roast_events_kind_idx").on(t.kind),
  ],
);

/** What "good" means for a profile, so a batch can be judged automatically. */
export const roastGoals = pgTable(
  "roast_goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => roastProfiles.id, { onDelete: "cascade" }),
    metric: roastGoalMetricEnum("metric").notNull(),
    targetValue: numeric("target_value", { precision: 12, scale: 4 }),
    minValue: numeric("min_value", { precision: 12, scale: 4 }),
    maxValue: numeric("max_value", { precision: 12, scale: 4 }),
    /** A blocking goal fails the batch rather than merely flagging it. */
    isBlocking: boolean("is_blocking").notNull().default(false),
  },
  (t) => [uniqueIndex("roast_goals_profile_metric_idx").on(t.profileId, t.metric)],
);

export const roastBatchGoalResults = pgTable(
  "roast_batch_goal_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => roastBatches.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => roastGoals.id, { onDelete: "set null" }),
    metric: roastGoalMetricEnum("metric").notNull(),
    actualValue: numeric("actual_value", { precision: 12, scale: 4 }),
    result: goalResultEnum("result").notNull().default("not_evaluated"),
    deviation: numeric("deviation", { precision: 12, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("roast_goal_results_batch_metric_idx").on(t.batchId, t.metric),
    index("roast_goal_results_org_result_idx").on(t.orgId, t.result, t.createdAt),
  ],
);

/**
 * A short-lived credential a shop-floor bridge presents when streaming.
 *
 * Scoped to one machine and stored as a hash, so a bridge on a factory PC
 * never holds a credential that could act on the rest of the organization —
 * which is the realistic threat: that machine is physically accessible and
 * rarely patched.
 */
export const machineBridgeTokens = pgTable(
  "machine_bridge_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /**
     * The roaster this token streams for. Null for a café bridge.
     *
     * A bar bridge and a roaster bridge are the same KIND of credential —
     * short lived, scoped to one machine, able to do nothing but stream —
     * facing different equipment. One table with two nullable references and a
     * constraint keeps the authentication path single, which matters because
     * this is the credential that lives on a physically accessible,
     * rarely-patched shop-floor PC.
     */
    machineId: uuid("machine_id").references(() => machines.id, { onDelete: "cascade" }),
    /** The bar equipment this token streams for. Null for a roaster. */
    cafeMachineId: uuid("cafe_machine_id"),
    tokenHash: text("token_hash").notNull(),
    tokenPrefix: text("token_prefix").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("machine_bridge_tokens_hash_idx").on(t.tokenHash),
    index("machine_bridge_tokens_org_machine_idx").on(t.orgId, t.machineId),
    index("machine_bridge_tokens_org_cafe_idx").on(t.orgId, t.cafeMachineId),
    // Exactly one target. A token scoped to nothing would authenticate a
    // bridge that could stream for any machine, which is the failure this
    // credential exists to prevent.
    check(
      "machine_bridge_tokens_one_target",
      sql`(machine_id is not null)::int + (cafe_machine_id is not null)::int = 1`,
    ),
  ],
);
