/**
 * EVERY pgEnum in the system lives here.
 *
 * Declaring the same enum name in two modules produces two objects and makes
 * drizzle-kit emit a duplicate `CREATE TYPE`. Centralizing them also removes
 * the most common source of circular imports between schema modules.
 */
import { pgEnum } from "drizzle-orm/pg-core";

/* ---------------------------------------------------------------- org */

export const locationKindEnum = pgEnum("location_kind", [
  "roastery",
  "warehouse",
  "cafe",
  "lab",
  "transit",
  "external",
]);

export const uomKindEnum = pgEnum("uom_kind", ["mass", "volume", "count", "bag", "length", "time"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "paused",
]);

export const actorTypeEnum = pgEnum("actor_type", ["user", "api_key", "oauth_client", "system"]);

/* ------------------------------------------------------------- catalog */

export const partnerTypeEnum = pgEnum("partner_type", [
  "supplier",
  "importer",
  "exporter",
  "cooperative",
  "producer",
  "mill",
  "broker",
  "warehouse",
  "customer",
]);

export const producerKindEnum = pgEnum("producer_kind", [
  "farm",
  "cooperative",
  "washing_station",
  "estate",
  "smallholder_group",
]);

export const roastMachineTypeEnum = pgEnum("roast_machine_type", [
  "drum",
  "fluid_bed",
  "recirculating",
  "sample",
  "tangential",
  "centrifugal",
]);

export const machineConnectivityEnum = pgEnum("machine_connectivity", [
  "none",
  "artisan",
  "bridge",
  "modbus",
  "serial",
  "cloud_api",
]);

export const productFormatEnum = pgEnum("product_format", [
  "whole_bean",
  "ground_espresso",
  "ground_filter",
  "ground_french_press",
  "capsule",
  "instant",
  "drip_bag",
  "bulk",
]);

/* ----------------------------------------------------------- inventory */

export const greenStateEnum = pgEnum("green_state", [
  "green",
  "parchment",
  "dry_cherry",
  "wet_parchment",
  "raw_green",
  "decaf_green",
]);

export const lotStatusEnum = pgEnum("lot_status", [
  "projected",
  "in_transit",
  "spot",
  "available",
  "reserved",
  "quarantined",
  "depleted",
  "archived",
]);

/**
 * What a ledger row means. The distinction is not cosmetic: reports group by
 * it ("how much did we roast", "how much did we write off"), and a generic
 * "adjustment" would collapse shrinkage, theft and a recount into one number.
 */
export const inventoryEventEnum = pgEnum("inventory_event", [
  "receive",
  "adjust",
  "allocate",
  "deallocate",
  "roast_consume",
  "transfer_out",
  "transfer_in",
  "split_out",
  "split_in",
  "merge_out",
  "merge_in",
  "sample_draw",
  "shrinkage",
  "write_off",
  "recount",
  "return",
]);

/** Nodes in the traceability graph. */
export const traceNodeKindEnum = pgEnum("trace_node_kind", [
  "producer",
  "green_lot",
  "roast_batch",
  "roasted_lot",
  "blend_lot",
  "product_batch",
  "order_line",
]);

export const costComponentKindEnum = pgEnum("cost_component_kind", [
  "base_price",
  "differential",
  "futures",
  "fx_adjustment",
  "carry",
  "storage",
  "freight",
  "insurance",
  "duty",
  "customs",
  "handling",
  "financing",
  "broker_fee",
  "sampling",
  "certification",
  "other",
]);

export const materialKindEnum = pgEnum("material_kind", [
  "bag",
  "label",
  "valve",
  "box",
  "tin",
  "capsule",
  "tape",
  "insert",
  "merch",
  "other",
]);

/* ------------------------------------------------------------- sourcing */

export const contractStatusEnum = pgEnum("contract_status", [
  "draft",
  "pending",
  "confirmed",
  "partially_shipped",
  "shipped",
  "arrived",
  "closed",
  "canceled",
  "defaulted",
]);

/**
 * How a price is set.
 *
 * `differential` and `to_be_fixed` are why unit prices carry six decimals: a
 * differential is quoted against a futures contract in fractions of a cent per
 * pound, and is not known in full until it is fixed.
 */
export const contractPriceTypeEnum = pgEnum("contract_price_type", [
  "fixed",
  "differential",
  "to_be_fixed",
  "formula",
]);

export const milestoneKindEnum = pgEnum("milestone_kind", [
  "contract_signed",
  "fixation",
  "shipment",
  "vessel_departure",
  "vessel_arrival",
  "customs_clearance",
  "warehouse_receipt",
  "sample_approval",
  "payment",
]);

export const milestoneStatusEnum = pgEnum("milestone_status", [
  "pending",
  "on_track",
  "at_risk",
  "completed",
  "missed",
]);

/** ICC Incoterms 2020. Fixed by standard, revised each decade. */
export const incotermEnum = pgEnum("incoterm", [
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
]);

export const shipmentStatusEnum = pgEnum("shipment_status", [
  "booked",
  "loaded",
  "in_transit",
  "arrived",
  "cleared",
  "delivered",
  "delayed",
  "canceled",
]);

export const sampleTypeEnum = pgEnum("sample_type", [
  "offer",
  "pre_shipment",
  "arrival",
  "type",
  "spot",
  "production",
  "competition",
]);

export const sampleStatusEnum = pgEnum("sample_status", [
  "requested",
  "in_transit",
  "received",
  "roasted",
  "cupped",
  "approved",
  "rejected",
  "archived",
]);
