/**
 * Traceability certificates and generated reports.
 *
 * The lineage itself lives in `lot_consumption` (inventory.ts) as a
 * polymorphic edge table. What lives here is the MATERIALIZED result: a
 * certificate that was true at the moment coffee shipped.
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { reportKindEnum, reportStatusEnum, traceNodeKindEnum } from "./enums";
import { fulfillments, salesOrderLines } from "./orders";
import { organizations } from "./org";
import { roastedLots } from "./roasted";

/**
 * A traceability certificate, frozen at issue time.
 *
 * Deliberately a snapshot rather than a live query. Lots get merged, split and
 * consumed after coffee ships, so re-deriving the chain later would produce a
 * certificate that does not describe what was in the bag. A customer scanning
 * a QR code eighteen months from now must see the coffee they bought.
 */
export const traceabilityRecords = pgTable(
  "traceability_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),

    /**
     * The public code printed on the bag. GLOBALLY unique, not per-org —
     * unlike every business code in this system — because it is looked up by
     * an unauthenticated phone in a café that has no organization in hand.
     */
    qrToken: text("qr_token").notNull(),

    roastedLotId: uuid("roasted_lot_id").references(() => roastedLots.id, {
      onDelete: "set null",
    }),
    orderLineId: uuid("order_line_id").references(() => salesOrderLines.id, {
      onDelete: "set null",
    }),
    fulfillmentId: uuid("fulfillment_id").references(() => fulfillments.id, {
      onDelete: "set null",
    }),

    /** What the public page shows: origin, producer, roast date, cupping notes. */
    snapshot: jsonb("snapshot").notNull(),
    /** The full chain as walked at issue time, for auditors rather than drinkers. */
    chain: jsonb("chain").notNull(),

    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("traceability_records_qr_token_idx").on(t.qrToken),
    index("traceability_records_org_created_idx").on(t.orgId, t.createdAt, t.id),
    index("traceability_records_lot_idx").on(t.orgId, t.roastedLotId),
  ],
);

/**
 * A generated report and where its artifact lives.
 *
 * The row exists before the artifact does, so a report that is still rendering
 * is a state a caller can see and poll rather than a request that hangs.
 */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    kind: reportKindEnum("kind").notNull(),
    status: reportStatusEnum("status").notNull().default("queued"),
    title: text("title").notNull(),
    /** The filters the report was run with, so it can be re-run identically. */
    parameters: jsonb("parameters").notNull(),

    /** R2 key. Never a public URL — see `reporting.getDownloadUrl`. */
    objectKey: text("object_key"),
    contentType: text("content_type"),
    sizeBytes: numeric("size_bytes", { precision: 18, scale: 0 }),
    error: text("error"),

    requestedBy: text("requested_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reports_org_created_idx").on(t.orgId, t.createdAt, t.id),
    index("reports_org_kind_idx").on(t.orgId, t.kind, t.status),
  ],
);

/** Re-exported so callers can name a node kind without reaching into enums. */
export { traceNodeKindEnum };

/**
 * A retail label design.
 *
 * Versioned rather than mutated, for the same reason a certificate is frozen:
 * a bag printed in March must stay reproducible after somebody redesigns the
 * label in June, or a recall cannot identify which bags carried which claim.
 */
export const labelTemplates = pgTable(
  "label_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),

    /** Millimetres. A label is a physical object and pixels are not a size. */
    widthMm: numeric("width_mm", { precision: 8, scale: 2 }).notNull(),
    heightMm: numeric("height_mm", { precision: 8, scale: 2 }).notNull(),
    marginMm: numeric("margin_mm", { precision: 8, scale: 2 }).notNull(),
    qrSizeMm: numeric("qr_size_mm", { precision: 8, scale: 2 }).notNull(),
    qrPosition: text("qr_position").notNull(),

    /** Ordered blocks. Shape is validated by Zod, not the database. */
    layout: jsonb("layout").$type<{
      blocks: {
        id: string;
        kind: "field" | "text" | "rule";
        /** A path into the certificate snapshot. Kept in step with
         *  `labelBindingSchema`; a value outside it renders as blank. */
        binding?:
          | "coffee.name"
          | "coffee.lotCode"
          | "coffee.roastLevel"
          | "coffee.roastedAt"
          | "origin.producer"
          | "origin.country"
          | "origin.region"
          | "origin.altitude"
          | "origin.process"
          | "origin.varieties"
          | "roast.batchNumber"
          | "quality.cuppingScore"
          | "quality.notes";
        text?: string;
        caption?: string;
        size: "xs" | "sm" | "md" | "lg" | "xl";
        weight: "regular" | "medium" | "bold";
        align: "left" | "center" | "right";
      }[];
    }>(),

    isDefault: boolean("is_default").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Versions are immutable; editing publishes a new one.
    uniqueIndex("label_templates_org_name_version_idx").on(t.orgId, t.name, t.version),
    // At most one default, or "which label do we print" is ambiguous.
    uniqueIndex("label_templates_org_default_idx").on(t.orgId).where(sql`is_default`),
    index("label_templates_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);
