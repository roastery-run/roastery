/**
 * Green purchase contracts, shipments and samples.
 *
 * A contract is a commitment made months before the coffee exists in
 * inventory, and the gap between the two is where a roastery's money actually
 * sits. So the model tracks POSITION — contracted, shipped, arrived, received
 * — rather than just a purchase record, because "what have I committed to and
 * where is it" is the question a green buyer asks daily.
 *
 * Receiving a shipment is the seam to Phase 4: it creates green lots and their
 * cost components, so a lot's landed cost is derived from the contract that
 * bought it rather than typed in twice.
 */
import { sql } from "drizzle-orm";
import {
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
import { partners, producers } from "./catalog";
import {
  contractPriceTypeEnum,
  contractStatusEnum,
  incotermEnum,
  milestoneKindEnum,
  milestoneStatusEnum,
  sampleStatusEnum,
  sampleTypeEnum,
  shipmentStatusEnum,
} from "./enums";
import { greenLots } from "./inventory";
import { locations, organizations } from "./org";

export const contracts = pgTable(
  "contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contractNumber: text("contract_number").notNull(),
    partnerId: uuid("partner_id")
      .notNull()
      .references(() => partners.id, { onDelete: "restrict" }),
    status: contractStatusEnum("status").notNull().default("draft"),
    contractDate: date("contract_date"),
    incoterm: incotermEnum("incoterm"),
    currency: text("currency").notNull().default("USD"),
    priceType: contractPriceTypeEnum("price_type").notNull().default("fixed"),
    paymentTermsDays: integer("payment_terms_days"),
    /**
     * Rolled up from the lines. Denormalized for the contract list, which is
     * the busiest screen in this module and would otherwise aggregate lines
     * per row.
     */
    totalWeightKg: numeric("total_weight_kg", { precision: 14, scale: 4 }).notNull().default("0"),
    shippedWeightKg: numeric("shipped_weight_kg", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    receivedWeightKg: numeric("received_weight_kg", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    totalValue: numeric("total_value", { precision: 18, scale: 4 }).notNull().default("0"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contracts_org_number_idx").on(t.orgId, t.contractNumber),
    index("contracts_org_status_date_idx").on(t.orgId, t.status, t.contractDate),
    index("contracts_org_partner_idx").on(t.orgId, t.partnerId),
    index("contracts_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

export const contractLines = pgTable(
  "contract_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    description: text("description").notNull(),
    producerId: uuid("producer_id").references(() => producers.id, { onDelete: "set null" }),

    weightKg: numeric("weight_kg", { precision: 14, scale: 4 }).notNull(),
    /** Drawn down as shipments are received; the line's remaining position. */
    receivedWeightKg: numeric("received_weight_kg", { precision: 14, scale: 4 })
      .notNull()
      .default("0"),
    bagCount: integer("bag_count"),
    bagWeightKg: numeric("bag_weight_kg", { precision: 10, scale: 4 }),

    /** Six decimals: a differential is quoted in fractions of a cent per pound. */
    unitPrice: numeric("unit_price", { precision: 18, scale: 6 }),
    differential: numeric("differential", { precision: 18, scale: 6 }),
    /** e.g. "KCZ26" — the futures contract a differential is quoted against. */
    futuresMonth: text("futures_month"),
    futuresPrice: numeric("futures_price", { precision: 18, scale: 6 }),
    /** Null until a to-be-fixed price is actually fixed. */
    fixedAt: timestamp("fixed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contract_lines_contract_position_idx").on(t.contractId, t.position),
    index("contract_lines_org_contract_idx").on(t.orgId, t.contractId),
    index("contract_lines_org_producer_idx").on(t.orgId, t.producerId),
  ],
);

/**
 * Dated commitments along a contract's life.
 *
 * Tracked because the cost of missing one is asymmetric: a late fixation or a
 * missed vessel is expensive and recoverable only if noticed early, which is
 * what the daily alert scan exists for.
 */
export const contractMilestones = pgTable(
  "contract_milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    contractLineId: uuid("contract_line_id").references(() => contractLines.id, {
      onDelete: "cascade",
    }),
    kind: milestoneKindEnum("kind").notNull(),
    status: milestoneStatusEnum("status").notNull().default("pending"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The "what is overdue" widget is org-wide, not per contract.
    index("contract_milestones_org_due_idx").on(t.orgId, t.dueAt, t.status),
    index("contract_milestones_org_contract_idx").on(t.orgId, t.contractId),
  ],
);

export const shipments = pgTable(
  "shipments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    reference: text("reference").notNull(),
    status: shipmentStatusEnum("status").notNull().default("booked"),
    vessel: text("vessel"),
    carrier: text("carrier"),
    containerNumber: text("container_number"),
    portOfLoading: text("port_of_loading"),
    portOfDischarge: text("port_of_discharge"),
    etd: date("etd"),
    eta: date("eta"),
    ata: date("ata"),
    destinationLocationId: uuid("destination_location_id").references(() => locations.id, {
      onDelete: "set null",
    }),
    weightKg: numeric("weight_kg", { precision: 14, scale: 4 }).notNull(),
    /** Set once received, so a shipment cannot be received twice. */
    receivedAt: timestamp("received_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("shipments_org_reference_idx").on(t.orgId, t.reference),
    index("shipments_org_status_eta_idx").on(t.orgId, t.status, t.eta),
    index("shipments_org_contract_idx").on(t.orgId, t.contractId),
  ],
);

/**
 * A physical sample.
 *
 * Kept distinct from inventory because a sample is evaluated, not stocked, and
 * its whole point is the decision it informs: approve the offer, reject the
 * shipment, or confirm arrival matches what was bought. Multiple tracking
 * numbers because a sample routinely travels through two couriers.
 */
export const samples = pgTable(
  "samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sampleNumber: text("sample_number").notNull(),
    sampleType: sampleTypeEnum("sample_type").notNull(),
    status: sampleStatusEnum("status").notNull().default("requested"),
    name: text("name").notNull(),
    partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "set null" }),
    producerId: uuid("producer_id").references(() => producers.id, { onDelete: "set null" }),
    contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "set null" }),
    contractLineId: uuid("contract_line_id").references(() => contractLines.id, {
      onDelete: "set null",
    }),
    /** Set when an approved sample is turned into stock. */
    greenLotId: uuid("green_lot_id").references(() => greenLots.id, { onDelete: "set null" }),

    poNumber: text("po_number"),
    salesNumber: text("sales_number"),
    trackingNumbers: text("tracking_numbers").array().notNull().default(sql`'{}'`),

    weightKg: numeric("weight_kg", { precision: 10, scale: 4 }),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNotes: text("decision_notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("samples_org_number_idx").on(t.orgId, t.sampleNumber),
    // The sample pipeline board: what is waiting on us, oldest first.
    index("samples_org_status_due_idx").on(t.orgId, t.status, t.dueAt),
    index("samples_org_type_idx").on(t.orgId, t.sampleType),
    index("samples_org_partner_idx").on(t.orgId, t.partnerId),
    index("samples_org_contract_idx").on(t.orgId, t.contractId),
    index("samples_org_created_idx").on(t.orgId, t.createdAt, t.id),
    // Couriers are searched by tracking number more often than by sample id.
    index("samples_tracking_idx").using("gin", t.trackingNumbers),
  ],
);

/**
 * Alert deduplication.
 *
 * The failure mode of an alerting system is not missing an alert, it is
 * sending the same one every day until someone mutes the channel. One row per
 * (rule, subject, day) makes a repeat send impossible rather than unlikely.
 */
export const alertNotifications = pgTable(
  "alert_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    subjectId: text("subject_id").notNull(),
    digestDate: date("digest_date").notNull(),
    severity: text("severity").notNull().default("info"),
    payload: text("payload"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("alert_notifications_dedupe_idx").on(t.orgId, t.ruleId, t.subjectId, t.digestDate),
    index("alert_notifications_org_date_idx").on(t.orgId, t.digestDate),
  ],
);
