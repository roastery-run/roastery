/**
 * Demand, allocation and production scheduling.
 *
 * The chain this module completes is the one the whole product exists for:
 * orders become demand, demand becomes a roast schedule, the schedule becomes
 * batches, and batches consume the green a contract bought. Everything before
 * this phase was inputs; this is where they turn into work.
 *
 * Allocation defaults to FEFO — first expiry, first out — rather than FIFO.
 * Roasted coffee has a usable window measured in weeks, so the lot that should
 * ship first is the one that goes stale first, which is not the lot that
 * happened to be roasted first once batches are produced on different days.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  date,
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
import { machines, partners, products } from "./catalog";
import {
  allocationStrategyEnum,
  customerTypeEnum,
  fulfillmentStatusEnum,
  salesChannelKindEnum,
  salesOrderStatusEnum,
  scheduleStatusEnum,
} from "./enums";
import { locations, organizations } from "./org";
import { roastProfiles } from "./production";
import { blends, roastedLots } from "./roasted";

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    customerType: customerTypeEnum("customer_type").notNull().default("wholesale"),
    /** A customer may also be a trading partner we buy from. */
    partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "set null" }),
    currency: text("currency").notNull().default("USD"),
    paymentTermsDays: integer("payment_terms_days"),
    creditLimit: numeric("credit_limit", { precision: 18, scale: 4 }),
    contactEmail: text("contact_email"),
    shippingAddress: text("shipping_address"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("customers_org_code_idx").on(t.orgId, t.code),
    index("customers_org_type_active_idx").on(t.orgId, t.customerType, t.isActive),
    index("customers_org_created_idx").on(t.orgId, t.createdAt, t.id),
    index("customers_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

export const salesOrders = pgTable(
  "sales_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderNumber: text("order_number").notNull(),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "restrict" }),
    channel: salesChannelKindEnum("channel").notNull().default("direct"),
    /** The id this order carries in the system it came from. */
    externalOrderId: text("external_order_id"),
    status: salesOrderStatusEnum("status").notNull().default("draft"),
    currency: text("currency").notNull().default("USD"),
    subtotal: numeric("subtotal", { precision: 18, scale: 4 }).notNull().default("0"),
    total: numeric("total", { precision: 18, scale: 4 }).notNull().default("0"),
    orderedAt: timestamp("ordered_at", { withTimezone: true }).notNull().defaultNow(),
    /** What the customer asked for; drives scheduling priority. */
    requestedShipAt: date("requested_ship_at"),
    promisedAt: date("promised_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sales_orders_org_number_idx").on(t.orgId, t.orderNumber),
    // Re-importing the same webstore order must not create a second one.
    uniqueIndex("sales_orders_org_channel_external_idx")
      .on(t.orgId, t.channel, t.externalOrderId)
      .where(sql`external_order_id is not null`),
    // The order board: the busiest screen in this module.
    index("sales_orders_org_status_ship_idx").on(t.orgId, t.status, t.requestedShipAt),
    index("sales_orders_org_customer_idx").on(t.orgId, t.customerId, t.orderedAt),
    index("sales_orders_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

export const salesOrderLines = pgTable(
  "sales_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    /** What must be roasted, when the line is for a blend rather than a product. */
    blendId: uuid("blend_id").references(() => blends.id, { onDelete: "set null" }),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
    /** Roasted weight this line represents; what scheduling actually needs. */
    weightKg: numeric("weight_kg", { precision: 14, scale: 4 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 18, scale: 6 }),
    lineTotal: numeric("line_total", { precision: 18, scale: 4 }),
    grindNote: text("grind_note"),
    allocatedWeightKg: numeric("allocated_weight_kg", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    fulfilledWeightKg: numeric("fulfilled_weight_kg", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sales_order_lines_order_position_idx").on(t.orderId, t.position),
    index("sales_order_lines_org_order_idx").on(t.orgId, t.orderId),
    index("sales_order_lines_org_blend_idx").on(t.orgId, t.blendId),
  ],
);

/**
 * A commitment of specific stock to a specific order line.
 *
 * Separate from the order line because one line can draw on several lots — a
 * 40 kg order filled from three batches — and because releasing an allocation
 * must return stock without touching the order.
 */
export const allocations = pgTable(
  "allocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderLineId: uuid("order_line_id")
      .notNull()
      .references(() => salesOrderLines.id, { onDelete: "cascade" }),
    roastedLotId: uuid("roasted_lot_id")
      .notNull()
      .references(() => roastedLots.id, { onDelete: "restrict" }),
    weightKg: numeric("weight_kg", { precision: 14, scale: 4 }).notNull(),
    strategy: allocationStrategyEnum("strategy").notNull().default("fefo"),
    allocatedAt: timestamp("allocated_at", { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (t) => [
    index("allocations_org_line_idx").on(t.orgId, t.orderLineId),
    index("allocations_org_lot_idx").on(t.orgId, t.roastedLotId),
    // Open allocations are what "how much of this lot is spoken for" reads.
    index("allocations_open_idx").on(t.orgId, t.roastedLotId).where(sql`released_at is null`),
  ],
);

export const fulfillments = pgTable(
  "fulfillments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => salesOrders.id, { onDelete: "cascade" }),
    fulfillmentNumber: text("fulfillment_number").notNull(),
    status: fulfillmentStatusEnum("status").notNull().default("pending"),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    carrier: text("carrier"),
    trackingNumber: text("tracking_number"),
    weightKg: numeric("weight_kg", { precision: 14, scale: 4 }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("fulfillments_org_number_idx").on(t.orgId, t.fulfillmentNumber),
    index("fulfillments_org_status_idx").on(t.orgId, t.status, t.shippedAt),
    index("fulfillments_org_order_idx").on(t.orgId, t.orderId),
  ],
);

/* ------------------------------------------------------------ scheduling */

export const productionSchedules = pgTable(
  "production_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    scheduledDate: date("scheduled_date").notNull(),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    status: scheduleStatusEnum("status").notNull().default("draft"),
    /** Shortfalls found while planning: reasons this schedule may not run. */
    feasibilityNotes: text("feasibility_notes").array().notNull().default(sql`'{}'`),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: text("released_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("production_schedules_org_date_idx").on(t.orgId, t.scheduledDate, t.status),
    index("production_schedules_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

/**
 * One planned roast.
 *
 * `position` is the running ORDER on the machine, and it is not arbitrary:
 * batches are grouped by profile to avoid changeovers, run light to dark
 * because a dark roast leaves residue that taints a lighter one after it, and
 * decaf goes last for the same reason.
 */
export const scheduledBatches = pgTable(
  "scheduled_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => productionSchedules.id, { onDelete: "cascade" }),
    machineId: uuid("machine_id").references(() => machines.id, { onDelete: "set null" }),
    profileId: uuid("profile_id").references(() => roastProfiles.id, { onDelete: "set null" }),
    blendId: uuid("blend_id").references(() => blends.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    plannedChargeKg: numeric("planned_charge_kg", { precision: 12, scale: 4 }).notNull(),
    plannedYieldKg: numeric("planned_yield_kg", { precision: 12, scale: 4 }),
    /** Which order lines this batch is for, so a roaster sees the why. */
    demandLineIds: text("demand_line_ids").array().notNull().default(sql`'{}'`),
    /** Set once a roaster actually starts it. */
    roastBatchId: uuid("roast_batch_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("scheduled_batches_schedule_machine_position_idx").on(
      t.scheduleId,
      t.machineId,
      t.position,
    ),
    index("scheduled_batches_org_schedule_idx").on(t.orgId, t.scheduleId),
    index("scheduled_batches_batch_idx").on(t.roastBatchId),
  ],
);
