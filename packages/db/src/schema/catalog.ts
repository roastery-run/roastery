/**
 * Reference data every other domain points at: who we trade with, where the
 * coffee was grown, what we sell, and the machines that roast it.
 */
import { sql } from "drizzle-orm";
import {
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
import {
  machineConnectivityEnum,
  partnerTypeEnum,
  producerKindEnum,
  productFormatEnum,
  roastMachineTypeEnum,
} from "./enums";
import { locations, organizations } from "./org";

/**
 * A trading partner.
 *
 * `types` is an array rather than a single kind because in this trade one
 * company is routinely several at once — an importer that also exports and
 * operates a warehouse. Modelling that as separate tables would duplicate the
 * same company three times and break every "who did we buy this from" report.
 */
export const partners = pgTable(
  "partners",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    types: partnerTypeEnum("types").array().notNull(),
    country: text("country"),
    defaultCurrency: text("default_currency"),
    paymentTermsDays: integer("payment_terms_days"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    website: text("website"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("partners_org_code_idx").on(t.orgId, t.code),
    index("partners_org_active_idx").on(t.orgId, t.isActive),
    index("partners_org_created_idx").on(t.orgId, t.createdAt, t.id),
    // Trigram index for the "start typing a supplier name" picker. Without it
    // an ILIKE '%x%' over a large partner list is a sequential scan.
    index("partners_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

export const producers = pgTable(
  "producers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    kind: producerKindEnum("kind").notNull(),
    /** The partner we actually buy through, when there is one. */
    partnerId: uuid("partner_id").references(() => partners.id, { onDelete: "set null" }),
    country: text("country"),
    region: text("region"),
    subregion: text("subregion"),
    altitudeMinM: integer("altitude_min_m"),
    altitudeMaxM: integer("altitude_max_m"),
    latitude: numeric("latitude", { precision: 9, scale: 6 }),
    longitude: numeric("longitude", { precision: 9, scale: 6 }),
    varieties: text("varieties").array().notNull().default(sql`'{}'`),
    processMethods: text("process_methods").array().notNull().default(sql`'{}'`),
    farmSizeHa: numeric("farm_size_ha", { precision: 10, scale: 2 }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("producers_org_code_idx").on(t.orgId, t.code),
    index("producers_org_country_idx").on(t.orgId, t.country, t.region),
    index("producers_org_partner_idx").on(t.orgId, t.partnerId),
    index("producers_org_created_idx").on(t.orgId, t.createdAt, t.id),
    index("producers_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    sku: text("sku").notNull(),
    name: text("name").notNull(),
    format: productFormatEnum("format").notNull(),
    /** Canonical kilograms, like every other weight in the system. */
    netWeightKg: numeric("net_weight_kg", { precision: 10, scale: 4 }),
    listPrice: numeric("list_price", { precision: 18, scale: 4 }),
    currency: text("currency"),
    barcode: text("barcode"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("products_org_sku_idx").on(t.orgId, t.sku),
    index("products_org_active_idx").on(t.orgId, t.isActive, t.format),
    index("products_org_barcode_idx").on(t.orgId, t.barcode),
    index("products_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);

/**
 * A roasting machine.
 *
 * `deviceId` is how a shop-floor bridge identifies itself when streaming
 * telemetry, so it is globally unique rather than per-org: the ingest endpoint
 * resolves the machine before any tenant is known.
 */
export const machines = pgTable(
  "machines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    locationId: uuid("location_id").references(() => locations.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    code: text("code").notNull(),
    brand: text("brand"),
    model: text("model"),
    machineType: roastMachineTypeEnum("machine_type").notNull().default("drum"),
    capacityKg: numeric("capacity_kg", { precision: 10, scale: 4 }),
    minBatchKg: numeric("min_batch_kg", { precision: 10, scale: 4 }),
    maxBatchKg: numeric("max_batch_kg", { precision: 10, scale: 4 }),
    connectivity: machineConnectivityEnum("connectivity").notNull().default("none"),
    deviceId: text("device_id"),
    isActive: boolean("is_active").notNull().default(true),
    installedAt: timestamp("installed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("machines_org_code_idx").on(t.orgId, t.code),
    uniqueIndex("machines_device_id_idx").on(t.deviceId),
    index("machines_org_location_idx").on(t.orgId, t.locationId, t.isActive),
    index("machines_org_created_idx").on(t.orgId, t.createdAt, t.id),
  ],
);
