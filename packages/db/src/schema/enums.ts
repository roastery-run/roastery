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

/* ----------------------------------------------------------- production */

export const roastBatchStatusEnum = pgEnum("roast_batch_status", [
  "scheduled",
  "in_progress",
  "cooling",
  "completed",
  "aborted",
  "discarded",
]);

export const roastPurposeEnum = pgEnum("roast_purpose", [
  "production",
  "sample",
  "development",
  "calibration",
  "training",
]);

/**
 * Roast events.
 *
 * First crack is HUMAN-OBSERVED — a roaster hears it — so it is recorded as an
 * operator input, never inferred from the curve. Treating it as derivable is
 * how a system quietly disagrees with the person standing at the machine.
 */
export const roastEventKindEnum = pgEnum("roast_event_kind", [
  "charge",
  "turning_point",
  "dry_end",
  "first_crack_start",
  "first_crack_end",
  "second_crack_start",
  "drop",
  "gas_change",
  "air_change",
  "drum_change",
  "note",
]);

export const roastGoalMetricEnum = pgEnum("roast_goal_metric", [
  "development_time_ratio",
  "weight_loss_pct",
  "drop_temp",
  "total_time",
  "first_crack_time",
  "agtron_ground",
  "agtron_whole",
  "ror_at_drop",
  "moisture_pct",
]);

export const goalResultEnum = pgEnum("goal_result", ["pass", "warn", "fail", "not_evaluated"]);

export const roastedLotKindEnum = pgEnum("roasted_lot_kind", ["loose", "packaged", "blended"]);

/**
 * When components are combined.
 *
 * A PRE-roast blend goes into the drum together and comes out as one lot; a
 * POST-roast blend combines separately-roasted lots afterwards. They taste
 * different and cost differently, so the distinction is recorded rather than
 * inferred.
 */
export const blendTypeEnum = pgEnum("blend_type", ["pre_roast", "post_roast"]);

/* -------------------------------------------------------------- quality */

export const formTemplateKindEnum = pgEnum("form_template_kind", [
  "cupping_sheet",
  "green_grading",
  "roast_qc",
  "brew_feedback",
  "sample_intake",
]);

export const gradingStandardEnum = pgEnum("grading_standard", [
  "sca",
  "coe",
  "brazil_ny",
  "indonesian",
  "vietnamese",
  "custom",
]);

/**
 * How much a cupper knows about what is in the cup.
 *
 * Blind means the cupper cannot see the sample's identity; double-blind means
 * neither the cupper nor the session lead can. The distinction matters because
 * a cupper who knows a coffee is expensive scores it higher, and a QC panel
 * that cannot demonstrate blindness cannot defend its scores to a supplier.
 */
export const cuppingModeEnum = pgEnum("cupping_mode", ["open", "blind", "double_blind"]);

export const cuppingSessionStatusEnum = pgEnum("cupping_session_status", [
  "draft",
  "scheduled",
  "in_progress",
  "scored",
  "finalized",
  "canceled",
]);

/* --------------------------------------------------------------- orders */

export const customerTypeEnum = pgEnum("customer_type", [
  "wholesale",
  "cafe",
  "retail",
  "distributor",
  "subscription",
  "internal",
  "export",
]);

export const salesChannelKindEnum = pgEnum("sales_channel_kind", [
  "direct",
  "webstore",
  "edi",
  "marketplace",
  "api",
]);

export const salesOrderStatusEnum = pgEnum("sales_order_status", [
  "draft",
  "confirmed",
  "in_production",
  "partially_fulfilled",
  "fulfilled",
  "invoiced",
  "paid",
  "canceled",
]);

/**
 * How stock is chosen to satisfy an order.
 *
 * FEFO — first expiry, first out — is the default for roasted coffee, because
 * it has a usable window measured in weeks. FIFO would ship the oldest coffee
 * that happens to have arrived first, which is not the same thing once lots
 * are roasted on different days.
 */
export const allocationStrategyEnum = pgEnum("allocation_strategy", [
  "fefo",
  "fifo",
  "lifo",
  "manual",
]);

export const fulfillmentStatusEnum = pgEnum("fulfillment_status", [
  "pending",
  "picking",
  "packed",
  "shipped",
  "delivered",
  "returned",
  "canceled",
]);

export const scheduleStatusEnum = pgEnum("schedule_status", [
  "draft",
  "released",
  "in_progress",
  "completed",
  "canceled",
]);

/* ---------------------------------------------------------------- webhooks */

/**
 * `auto_disabled` is deliberately distinct from `disabled`.
 *
 * A human turning an endpoint off and the system turning it off after twenty
 * consecutive failures are different facts, and the console has to be able to
 * say which happened. Collapsing them would make a self-inflicted outage look
 * like a deliberate configuration change.
 */
export const webhookEndpointStatusEnum = pgEnum("webhook_endpoint_status", [
  "active",
  "disabled",
  "auto_disabled",
]);

/**
 * `dead` means "we stopped trying", which is not the same as `failed`.
 *
 * A failed delivery is still in the retry schedule; a dead one has exhausted
 * it, or hit a status that says retrying is pointless. Only `dead` should page
 * anybody.
 */
export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "succeeded",
  "failed",
  "dead",
]);

/* -------------------------------------------------------------------- cafe */

export const cafeMachineKindEnum = pgEnum("cafe_machine_kind", [
  "espresso_machine",
  "grinder",
  "batch_brewer",
  "water_system",
]);

/**
 * Why a shot was not in specification.
 *
 * Stored rather than derived at read time because the specification a shot was
 * judged against can change: re-deriving next month would rewrite history and
 * make last week's quality report disagree with itself.
 */
export const shotVerdictEnum = pgEnum("shot_verdict", [
  "in_spec",
  "fast",
  "slow",
  "under_dosed",
  "over_dosed",
  "channeling",
  "discarded",
]);

export const posReconciliationStatusEnum = pgEnum("pos_reconciliation_status", [
  "pending",
  "matched",
  "shot_missing",
  "sale_missing",
  "quantity_mismatch",
]);

/* ------------------------------------------------------------ traceability */

export const traceDirectionEnum = pgEnum("trace_direction", ["backward", "forward"]);

export const reportKindEnum = pgEnum("report_kind", [
  "traceability_certificate",
  "inventory_valuation",
  "production_summary",
  "quality_summary",
  "cafe_performance",
]);

export const reportStatusEnum = pgEnum("report_status", ["queued", "rendering", "ready", "failed"]);

/**
 * What a line's unit price is quoted against.
 *
 * A roastery sells both: a 250 g retail bag is priced per unit, a 25 kg
 * wholesale sack is priced per kilogram. Without this the total has to guess,
 * and guessing "per unit" prices a 44 kg line the same as a 4 kg one.
 */
export const priceUnitEnum = pgEnum("price_unit", ["unit", "kg"]);
