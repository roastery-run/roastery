/**
 * Quality: cupping and green grading.
 *
 * THE CUSTOM-FORM DECISION, stated once. Cupping sheets and grading standards
 * are user-customizable — an SCA sheet, a Cup of Excellence sheet, and a
 * roaster's own house form all differ — so responses are stored as JSONB
 * against a versioned template.
 *
 * But every field that is CHARTED, FILTERED or AVERAGED is promoted to a real
 * column: `total_score` and the ten SCA subscores, moisture, water activity,
 * defect counts. EAV would make one cupping sheet a join-and-pivot over forty
 * rows and "average flavour for this lot over six months" a self-join with no
 * usable index. The rule is: JSONB for the long tail, columns for anything in
 * a WHERE, ORDER BY or AVG.
 *
 * Templates are IMMUTABLE per version, and responses record the version they
 * were filled against, so a sheet from 2023 still renders as it was filled.
 * In a system whose output a supplier may dispute, that is not optional.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import {
  cuppingModeEnum,
  cuppingSessionStatusEnum,
  formTemplateKindEnum,
  gradingStandardEnum,
} from "./enums";
import { greenLots } from "./inventory";
import { locations, organizations } from "./org";
import { roastBatches } from "./production";
import { roastedLots } from "./roasted";
import { samples } from "./sourcing";

export const formTemplates = pgTable(
  "form_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: formTemplateKindEnum("kind").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    /** Field definitions. Shape is validated by a Zod schema, not the database. */
    schema: jsonb("schema").$type<{
      fields: {
        key: string;
        label: string;
        type: "number" | "text" | "select" | "boolean";
        min?: number;
        max?: number;
        step?: number;
        options?: string[];
      }[];
    }>(),
    isDefault: boolean("is_default").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Versions are immutable; editing publishes a new one.
    uniqueIndex("form_templates_org_kind_name_version_idx").on(t.orgId, t.kind, t.name, t.version),
    // At most one default per kind, or "which sheet do we use" is ambiguous.
    uniqueIndex("form_templates_org_kind_default_idx").on(t.orgId, t.kind).where(sql`is_default`),
    index("form_templates_org_kind_idx").on(t.orgId, t.kind, t.archivedAt),
  ],
);

export const cuppingSessions = pgTable(
  "cupping_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sessionNumber: text("session_number").notNull(),
    name: text("name").notNull(),
    mode: cuppingModeEnum("mode").notNull().default("blind"),
    status: cuppingSessionStatusEnum("status").notNull().default("draft"),
    templateId: uuid("template_id").references(() => formTemplates.id, { onDelete: "set null" }),
    /** Recorded so an old sheet renders as it was filled, not as it is now. */
    templateVersion: integer("template_version"),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    leadUserId: text("lead_user_id").references(() => users.id, { onDelete: "set null" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cupping_sessions_org_number_idx").on(t.orgId, t.sessionNumber),
    index("cupping_sessions_org_status_idx").on(t.orgId, t.status, t.scheduledAt),
    index("cupping_sessions_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

/**
 * One coffee on the table.
 *
 * `blindCode` is what a cupper sees in a blind session — the identity columns
 * are deliberately not shown to them, which is the whole point of blindness.
 */
export const cuppingSessionSamples = pgTable(
  "cupping_session_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => cuppingSessions.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    blindCode: text("blind_code").notNull(),
    sampleId: uuid("sample_id").references(() => samples.id, { onDelete: "set null" }),
    greenLotId: uuid("green_lot_id").references(() => greenLots.id, { onDelete: "set null" }),
    roastedLotId: uuid("roasted_lot_id").references(() => roastedLots.id, { onDelete: "set null" }),
    roastBatchId: uuid("roast_batch_id").references(() => roastBatches.id, {
      onDelete: "set null",
    }),
    /** Recomputed on finalize; denormalized because it is read on every list. */
    avgTotalScore: numeric("avg_total_score", { precision: 5, scale: 2 }),
    scoreCount: integer("score_count").notNull().default(0),
    /** Spread across cuppers. A high value means the panel disagreed. */
    scoreStdDev: numeric("score_std_dev", { precision: 5, scale: 3 }),
  },
  (t) => [
    uniqueIndex("cupping_samples_session_position_idx").on(t.sessionId, t.position),
    uniqueIndex("cupping_samples_session_code_idx").on(t.sessionId, t.blindCode),
    index("cupping_samples_org_green_idx").on(t.orgId, t.greenLotId),
    index("cupping_samples_org_sample_idx").on(t.orgId, t.sampleId),
  ],
);

/**
 * One cupper's score for one coffee.
 *
 * The SCA subscores are columns rather than JSONB because the quality-over-
 * time chart, the supplier scorecard and the calibration report all aggregate
 * them. Anything a house sheet adds beyond these lives in `responses`.
 */
export const cuppingScores = pgTable(
  "cupping_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sessionSampleId: uuid("session_sample_id")
      .notNull()
      .references(() => cuppingSessionSamples.id, { onDelete: "cascade" }),
    cupperUserId: text("cupper_user_id").references(() => users.id, { onDelete: "set null" }),
    /** External cuppers — a visiting Q grader — have no account. */
    cupperName: text("cupper_name"),

    totalScore: numeric("total_score", { precision: 5, scale: 2 }),
    fragrance: numeric("fragrance", { precision: 4, scale: 2 }),
    flavor: numeric("flavor", { precision: 4, scale: 2 }),
    aftertaste: numeric("aftertaste", { precision: 4, scale: 2 }),
    acidity: numeric("acidity", { precision: 4, scale: 2 }),
    body: numeric("body", { precision: 4, scale: 2 }),
    balance: numeric("balance", { precision: 4, scale: 2 }),
    uniformity: numeric("uniformity", { precision: 4, scale: 2 }),
    cleanCup: numeric("clean_cup", { precision: 4, scale: 2 }),
    sweetness: numeric("sweetness", { precision: 4, scale: 2 }),
    overall: numeric("overall", { precision: 4, scale: 2 }),
    defectsPenalty: numeric("defects_penalty", { precision: 5, scale: 2 }).notNull().default("0"),

    descriptors: text("descriptors").array().notNull().default(sql`'{}'`),
    /** The long tail: whatever a house sheet adds beyond the SCA fields. */
    responses: jsonb("responses").$type<Record<string, unknown>>(),
    notes: text("notes"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One score per cupper per coffee.
    //
    // A unique CONSTRAINT rather than a unique index, because only the
    // constraint builder exposes nullsNotDistinct — and without it Postgres
    // treats every NULL as distinct, so a cupper with no account could submit
    // the same coffee any number of times and the "one score per cupper" rule
    // would silently not hold for exactly the people it matters most for:
    // visiting graders.
    unique("cupping_scores_sample_cupper_key")
      .on(t.sessionSampleId, t.cupperUserId, t.cupperName)
      .nullsNotDistinct(),
    index("cupping_scores_org_cupper_idx").on(t.orgId, t.cupperUserId, t.submittedAt),
    // The quality-over-time and score-threshold screens.
    index("cupping_scores_org_total_idx").on(t.orgId, t.totalScore),
  ],
);

/**
 * Physical evaluation of green coffee.
 *
 * A failing grading QUARANTINES the lot, which blocks reservation — the point
 * of grading is to stop coffee reaching production, so a result that is merely
 * recorded and not enforced is decoration.
 */
export const greenGradings = pgTable(
  "green_gradings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    greenLotId: uuid("green_lot_id").references(() => greenLots.id, { onDelete: "cascade" }),
    sampleId: uuid("sample_id").references(() => samples.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => formTemplates.id, { onDelete: "set null" }),
    templateVersion: integer("template_version"),
    standard: gradingStandardEnum("standard").notNull().default("sca"),
    graderUserId: text("grader_user_id").references(() => users.id, { onDelete: "set null" }),

    /* Promoted because every one of these is charted or filtered. */
    moisturePct: numeric("moisture_pct", { precision: 5, scale: 2 }),
    waterActivity: numeric("water_activity", { precision: 4, scale: 3 }),
    screenSizeAvg: numeric("screen_size_avg", { precision: 5, scale: 2 }),
    densityGPerL: numeric("density_g_per_l", { precision: 7, scale: 2 }),
    colorScore: numeric("color_score", { precision: 6, scale: 2 }),
    defectsPrimary: integer("defects_primary").notNull().default(0),
    defectsSecondary: integer("defects_secondary").notNull().default(0),
    /** The SCA figure: primary defects weigh far more than secondary. */
    fullDefectEquivalents: numeric("full_defect_equivalents", { precision: 6, scale: 2 }),
    grade: text("grade"),
    passed: boolean("passed").notNull().default(true),

    /** Per-screen and per-defect-type breakdowns: the long tail. */
    screenDistribution: jsonb("screen_distribution").$type<Record<string, number>>(),
    defectCounts: jsonb("defect_counts").$type<Record<string, number>>(),
    responses: jsonb("responses").$type<Record<string, unknown>>(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("green_gradings_org_lot_idx").on(t.orgId, t.greenLotId, t.createdAt),
    index("green_gradings_org_sample_idx").on(t.orgId, t.sampleId),
    index("green_gradings_org_passed_idx").on(t.orgId, t.passed, t.createdAt),
  ],
);
