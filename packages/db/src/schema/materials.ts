/**
 * Non-coffee inventory: bags, labels, valves, boxes, merchandise.
 *
 * Separate from green lots rather than a shared "item" table, because the two
 * behave nothing alike. A green lot is a unique, traceable, divisible batch
 * with provenance and a landed cost; a material is a fungible countable SKU.
 * Forcing them into one table would mean every green-lot query carries columns
 * that never apply, and every material carries a lineage graph it never uses.
 *
 * What they share is the ledger DISCIPLINE — a balance that is only ever moved
 * by an append-only transaction — not the table.
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
import { partners, products } from "./catalog";
import { inventoryEventEnum, materialKindEnum } from "./enums";
import { locations, organizations, unitsOfMeasure } from "./org";

export const materials = pgTable(
  "materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    kind: materialKindEnum("kind").notNull(),
    unitId: uuid("unit_id").references(() => unitsOfMeasure.id, { onDelete: "set null" }),
    unitCost: numeric("unit_cost", { precision: 18, scale: 6 }),
    currency: text("currency"),
    /** Balance cache, moved only by a material transaction. */
    onHandQty: numeric("on_hand_qty", { precision: 14, scale: 4 }).notNull().default("0"),
    /**
     * Reorder point and lead time are what turn a stock level into a decision:
     * "below reorder" alone is not actionable without knowing how long a
     * replacement takes to arrive.
     */
    reorderPoint: numeric("reorder_point", { precision: 14, scale: 4 }),
    reorderQty: numeric("reorder_qty", { precision: 14, scale: 4 }),
    leadTimeDays: integer("lead_time_days"),
    supplierPartnerId: uuid("supplier_partner_id").references(() => partners.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("materials_org_sku_idx").on(t.orgId, t.sku),
    index("materials_org_kind_idx").on(t.orgId, t.kind, t.isActive),
    index("materials_org_supplier_idx").on(t.orgId, t.supplierPartnerId),
    index("materials_org_created_idx").on(t.orgId, t.createdAt, t.id),
    // The "what do I need to order" screen.
    index("materials_org_reorder_idx")
      .on(t.orgId, t.onHandQty)
      .where(sql`reorder_point is not null`),
  ],
);

export const materialTransactions = pgTable(
  "material_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "cascade" }),
    /** Same concurrency guard as the green ledger. */
    seq: bigint("seq", { mode: "number" }).notNull(),
    eventType: inventoryEventEnum("event_type").notNull(),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    qtyBefore: numeric("qty_before", { precision: 14, scale: 4 }).notNull(),
    deltaQty: numeric("delta_qty", { precision: 14, scale: 4 }).notNull(),
    qtyAfter: numeric("qty_after", { precision: 14, scale: 4 }).notNull(),
    comment: text("comment"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("material_txn_material_seq_idx").on(t.materialId, t.seq),
    index("material_txn_org_material_time_idx").on(t.orgId, t.materialId, t.occurredAt),
  ],
);

/**
 * What a finished product is made of.
 *
 * Versioned rather than edited in place: a BOM change must not retroactively
 * alter what a batch produced last month, which is what a cost report and an
 * audit both depend on.
 */
export const billsOfMaterials = pgTable(
  "bills_of_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    /** How many finished units one run of this BOM produces. */
    yieldQty: integer("yield_qty").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bom_org_product_version_idx").on(t.orgId, t.productId, t.version),
    // At most one active BOM per product: two would make "what does this cost"
    // ambiguous.
    uniqueIndex("bom_org_product_active_idx").on(t.orgId, t.productId).where(sql`is_active`),
  ],
);

export const bomLines = pgTable(
  "bom_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    bomId: uuid("bom_id")
      .notNull()
      .references(() => billsOfMaterials.id, { onDelete: "cascade" }),
    materialId: uuid("material_id")
      .notNull()
      .references(() => materials.id, { onDelete: "restrict" }),
    quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
    /** Expected loss, so a requirement reflects what is actually consumed. */
    scrapPct: numeric("scrap_pct", { precision: 5, scale: 2 }).notNull().default("0"),
    position: integer("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("bom_lines_bom_position_idx").on(t.bomId, t.position),
    index("bom_lines_material_idx").on(t.materialId),
  ],
);
