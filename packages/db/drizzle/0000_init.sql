CREATE TYPE "public"."actor_type" AS ENUM('user', 'api_key', 'oauth_client', 'system');--> statement-breakpoint
CREATE TYPE "public"."allocation_strategy" AS ENUM('fefo', 'fifo', 'lifo', 'manual');--> statement-breakpoint
CREATE TYPE "public"."blend_type" AS ENUM('pre_roast', 'post_roast');--> statement-breakpoint
CREATE TYPE "public"."contract_price_type" AS ENUM('fixed', 'differential', 'to_be_fixed', 'formula');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('draft', 'pending', 'confirmed', 'partially_shipped', 'shipped', 'arrived', 'closed', 'canceled', 'defaulted');--> statement-breakpoint
CREATE TYPE "public"."cost_component_kind" AS ENUM('base_price', 'differential', 'futures', 'fx_adjustment', 'carry', 'storage', 'freight', 'insurance', 'duty', 'customs', 'handling', 'financing', 'broker_fee', 'sampling', 'certification', 'other');--> statement-breakpoint
CREATE TYPE "public"."cupping_mode" AS ENUM('open', 'blind', 'double_blind');--> statement-breakpoint
CREATE TYPE "public"."cupping_session_status" AS ENUM('draft', 'scheduled', 'in_progress', 'scored', 'finalized', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('wholesale', 'cafe', 'retail', 'distributor', 'subscription', 'internal', 'export');--> statement-breakpoint
CREATE TYPE "public"."form_template_kind" AS ENUM('cupping_sheet', 'green_grading', 'roast_qc', 'brew_feedback', 'sample_intake');--> statement-breakpoint
CREATE TYPE "public"."fulfillment_status" AS ENUM('pending', 'picking', 'packed', 'shipped', 'delivered', 'returned', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."goal_result" AS ENUM('pass', 'warn', 'fail', 'not_evaluated');--> statement-breakpoint
CREATE TYPE "public"."grading_standard" AS ENUM('sca', 'coe', 'brazil_ny', 'indonesian', 'vietnamese', 'custom');--> statement-breakpoint
CREATE TYPE "public"."green_state" AS ENUM('green', 'parchment', 'dry_cherry', 'wet_parchment', 'raw_green', 'decaf_green');--> statement-breakpoint
CREATE TYPE "public"."incoterm" AS ENUM('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP');--> statement-breakpoint
CREATE TYPE "public"."inventory_event" AS ENUM('receive', 'adjust', 'allocate', 'deallocate', 'roast_consume', 'transfer_out', 'transfer_in', 'split_out', 'split_in', 'merge_out', 'merge_in', 'sample_draw', 'shrinkage', 'write_off', 'recount', 'return');--> statement-breakpoint
CREATE TYPE "public"."location_kind" AS ENUM('roastery', 'warehouse', 'cafe', 'lab', 'transit', 'external');--> statement-breakpoint
CREATE TYPE "public"."lot_status" AS ENUM('projected', 'in_transit', 'spot', 'available', 'reserved', 'quarantined', 'depleted', 'archived');--> statement-breakpoint
CREATE TYPE "public"."machine_connectivity" AS ENUM('none', 'artisan', 'bridge', 'modbus', 'serial', 'cloud_api');--> statement-breakpoint
CREATE TYPE "public"."material_kind" AS ENUM('bag', 'label', 'valve', 'box', 'tin', 'capsule', 'tape', 'insert', 'merch', 'other');--> statement-breakpoint
CREATE TYPE "public"."milestone_kind" AS ENUM('contract_signed', 'fixation', 'shipment', 'vessel_departure', 'vessel_arrival', 'customs_clearance', 'warehouse_receipt', 'sample_approval', 'payment');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('pending', 'on_track', 'at_risk', 'completed', 'missed');--> statement-breakpoint
CREATE TYPE "public"."partner_type" AS ENUM('supplier', 'importer', 'exporter', 'cooperative', 'producer', 'mill', 'broker', 'warehouse', 'customer');--> statement-breakpoint
CREATE TYPE "public"."producer_kind" AS ENUM('farm', 'cooperative', 'washing_station', 'estate', 'smallholder_group');--> statement-breakpoint
CREATE TYPE "public"."product_format" AS ENUM('whole_bean', 'ground_espresso', 'ground_filter', 'ground_french_press', 'capsule', 'instant', 'drip_bag', 'bulk');--> statement-breakpoint
CREATE TYPE "public"."roast_batch_status" AS ENUM('scheduled', 'in_progress', 'cooling', 'completed', 'aborted', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."roast_event_kind" AS ENUM('charge', 'turning_point', 'dry_end', 'first_crack_start', 'first_crack_end', 'second_crack_start', 'drop', 'gas_change', 'air_change', 'drum_change', 'note');--> statement-breakpoint
CREATE TYPE "public"."roast_goal_metric" AS ENUM('development_time_ratio', 'weight_loss_pct', 'drop_temp', 'total_time', 'first_crack_time', 'agtron_ground', 'agtron_whole', 'ror_at_drop', 'moisture_pct');--> statement-breakpoint
CREATE TYPE "public"."roast_machine_type" AS ENUM('drum', 'fluid_bed', 'recirculating', 'sample', 'tangential', 'centrifugal');--> statement-breakpoint
CREATE TYPE "public"."roast_purpose" AS ENUM('production', 'sample', 'development', 'calibration', 'training');--> statement-breakpoint
CREATE TYPE "public"."roasted_lot_kind" AS ENUM('loose', 'packaged', 'blended');--> statement-breakpoint
CREATE TYPE "public"."sales_channel_kind" AS ENUM('direct', 'webstore', 'edi', 'marketplace', 'api');--> statement-breakpoint
CREATE TYPE "public"."sales_order_status" AS ENUM('draft', 'confirmed', 'in_production', 'partially_fulfilled', 'fulfilled', 'invoiced', 'paid', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."sample_status" AS ENUM('requested', 'in_transit', 'received', 'roasted', 'cupped', 'approved', 'rejected', 'archived');--> statement-breakpoint
CREATE TYPE "public"."sample_type" AS ENUM('offer', 'pre_shipment', 'arrival', 'type', 'spot', 'production', 'competition');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('draft', 'released', 'in_progress', 'completed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('booked', 'loaded', 'in_transit', 'arrived', 'cleared', 'delivered', 'delayed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'paused');--> statement-breakpoint
CREATE TYPE "public"."trace_node_kind" AS ENUM('producer', 'green_lot', 'roast_batch', 'roasted_lot', 'blend_lot', 'product_batch', 'order_line');--> statement-breakpoint
CREATE TYPE "public"."uom_kind" AS ENUM('mass', 'volume', 'count', 'bag', 'length', 'time');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"id_token" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_i_d" text NOT NULL,
	"counter" integer DEFAULT 0 NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"location_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"brand" text,
	"model" text,
	"machine_type" "roast_machine_type" DEFAULT 'drum' NOT NULL,
	"capacity_kg" numeric(10, 4),
	"min_batch_kg" numeric(10, 4),
	"max_batch_kg" numeric(10, 4),
	"connectivity" "machine_connectivity" DEFAULT 'none' NOT NULL,
	"device_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"installed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"types" "partner_type"[] NOT NULL,
	"country" text,
	"default_currency" text,
	"payment_terms_days" integer,
	"contact_email" text,
	"contact_phone" text,
	"website" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "producers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"kind" "producer_kind" NOT NULL,
	"partner_id" uuid,
	"country" text,
	"region" text,
	"subregion" text,
	"altitude_min_m" integer,
	"altitude_max_m" integer,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"varieties" text[] DEFAULT '{}' NOT NULL,
	"process_methods" text[] DEFAULT '{}' NOT NULL,
	"farm_size_ha" numeric(10, 2),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"format" "product_format" NOT NULL,
	"net_weight_kg" numeric(10, 4),
	"list_price" numeric(18, 4),
	"currency" text,
	"barcode" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"green_lot_id" uuid,
	"contract_line_id" uuid,
	"kind" "cost_component_kind" NOT NULL,
	"label" text,
	"amount" numeric(18, 4) NOT NULL,
	"currency" text NOT NULL,
	"fx_rate_used" numeric(18, 8),
	"amount_base" numeric(18, 4) NOT NULL,
	"per_unit" boolean DEFAULT false NOT NULL,
	"unit_id" uuid,
	"incurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "green_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lot_code" text NOT NULL,
	"supplier_ref" text,
	"producer_id" uuid,
	"partner_id" uuid,
	"parent_lot_id" uuid,
	"state" "green_state" DEFAULT 'green' NOT NULL,
	"status" "lot_status" DEFAULT 'available' NOT NULL,
	"varieties" text[] DEFAULT '{}' NOT NULL,
	"process_method" text,
	"harvest_year" integer,
	"certifications" text[] DEFAULT '{}' NOT NULL,
	"initial_weight_kg" numeric(14, 4) NOT NULL,
	"current_weight_kg" numeric(14, 4) DEFAULT '0' NOT NULL,
	"reserved_weight_kg" numeric(14, 4) DEFAULT '0' NOT NULL,
	"min_weight_kg" numeric(14, 4),
	"entered_value" numeric(14, 4),
	"entered_unit_id" uuid,
	"bag_count" integer,
	"bag_weight_kg" numeric(10, 4),
	"unit_cost" numeric(18, 6),
	"cost_unit_id" uuid,
	"currency" text,
	"total_value_base" numeric(18, 4),
	"fx_rate_used" numeric(18, 8),
	"default_location_id" uuid,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"green_lot_id" uuid NOT NULL,
	"expected_kg" numeric(14, 4) NOT NULL,
	"actual_kg" numeric(14, 4) NOT NULL,
	"drift_kg" numeric(14, 4) NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"green_lot_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"event_type" "inventory_event" NOT NULL,
	"location_id" uuid,
	"weight_before_kg" numeric(14, 4) NOT NULL,
	"delta_kg" numeric(14, 4) NOT NULL,
	"weight_after_kg" numeric(14, 4) NOT NULL,
	"group_id" uuid,
	"counterparty_lot_id" uuid,
	"roast_batch_id" uuid,
	"contract_line_id" uuid,
	"comment" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landed_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"green_lot_id" uuid NOT NULL,
	"base_price_base" numeric(18, 4) DEFAULT '0' NOT NULL,
	"freight_base" numeric(18, 4) DEFAULT '0' NOT NULL,
	"duty_base" numeric(18, 4) DEFAULT '0' NOT NULL,
	"carry_base" numeric(18, 4) DEFAULT '0' NOT NULL,
	"other_base" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total_base" numeric(18, 4) DEFAULT '0' NOT NULL,
	"per_kg_base" numeric(18, 6) DEFAULT '0' NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lot_consumption" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"source_kind" "trace_node_kind" NOT NULL,
	"source_id" uuid NOT NULL,
	"target_kind" "trace_node_kind" NOT NULL,
	"target_id" uuid NOT NULL,
	"weight_kg" numeric(14, 4) NOT NULL,
	"ratio_pct" numeric(7, 4),
	"transaction_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lot_location_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"green_lot_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"weight_kg" numeric(14, 4) DEFAULT '0' NOT NULL,
	"bag_count" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bills_of_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"yield_qty" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bom_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"bom_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"scrap_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"event_type" "inventory_event" NOT NULL,
	"location_id" uuid,
	"qty_before" numeric(14, 4) NOT NULL,
	"delta_qty" numeric(14, 4) NOT NULL,
	"qty_after" numeric(14, 4) NOT NULL,
	"comment" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"kind" "material_kind" NOT NULL,
	"unit_id" uuid,
	"unit_cost" numeric(18, 6),
	"currency" text,
	"on_hand_qty" numeric(14, 4) DEFAULT '0' NOT NULL,
	"reorder_point" numeric(14, 4),
	"reorder_qty" numeric(14, 4),
	"lead_time_days" integer,
	"supplier_partner_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"refresh_id" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone,
	"revoked" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_access_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauth_client_assertions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_client_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"client_credentials_scopes" text[] DEFAULT '{}',
	"user_id" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text[],
	"response_types" text[],
	"require_p_k_c_e" boolean,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "oauth_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "oauth_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone,
	"revoked" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp with time zone,
	"auth_time" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "oauth_refresh_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "oauth_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "oauth_resources_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"config_id" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"reference_id" uuid NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp with time zone,
	"rate_limit_enabled" boolean DEFAULT true NOT NULL,
	"rate_limit_time_window" integer,
	"rate_limit_max" integer,
	"request_count" integer DEFAULT 0 NOT NULL,
	"remaining" integer,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"last_request" timestamp with time zone,
	"metadata" text,
	"permissions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"actor_id" text,
	"actor_type" "actor_type" NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor_id" text,
	"actor_type" "actor_type" NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fanned_out_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"kind" "location_kind" NOT NULL,
	"address" jsonb,
	"timezone" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_entitlement_overrides" (
	"org_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"set_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "org_entitlement_overrides_org_id_key_pk" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "org_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role_slug" text DEFAULT 'viewer' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role_slug" text DEFAULT 'viewer' NOT NULL,
	"default_location_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "org_subscriptions" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"plan_slug" text NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"external_ref" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"default_weight_unit" text DEFAULT 'kg' NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"slug" text PRIMARY KEY NOT NULL,
	"resource" text NOT NULL,
	"action" text NOT NULL,
	"module" text NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_entitlements" (
	"plan_slug" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	CONSTRAINT "plan_entitlements_plan_slug_key_pk" PRIMARY KEY("plan_slug","key")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"price_monthly" numeric(12, 2),
	"currency" text DEFAULT 'EUR' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_slug" text NOT NULL,
	"permission_slug" text NOT NULL,
	CONSTRAINT "role_permissions_role_slug_permission_slug_pk" PRIMARY KEY("role_slug","permission_slug")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"slug" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"org_id" uuid,
	"rank" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units_of_measure" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" "uom_kind" NOT NULL,
	"factor_to_kg" numeric(18, 8),
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_line_id" uuid NOT NULL,
	"roasted_lot_id" uuid NOT NULL,
	"weight_kg" numeric(14, 4) NOT NULL,
	"strategy" "allocation_strategy" DEFAULT 'fefo' NOT NULL,
	"allocated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"customer_type" "customer_type" DEFAULT 'wholesale' NOT NULL,
	"partner_id" uuid,
	"currency" text DEFAULT 'USD' NOT NULL,
	"payment_terms_days" integer,
	"credit_limit" numeric(18, 4),
	"contact_email" text,
	"shipping_address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fulfillments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"fulfillment_number" text NOT NULL,
	"status" "fulfillment_status" DEFAULT 'pending' NOT NULL,
	"location_id" uuid,
	"carrier" text,
	"tracking_number" text,
	"weight_kg" numeric(14, 4),
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "production_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scheduled_date" date NOT NULL,
	"location_id" uuid,
	"status" "schedule_status" DEFAULT 'draft' NOT NULL,
	"feasibility_notes" text[] DEFAULT '{}' NOT NULL,
	"released_at" timestamp with time zone,
	"released_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"product_id" uuid,
	"blend_id" uuid,
	"description" text NOT NULL,
	"quantity" numeric(14, 4) NOT NULL,
	"weight_kg" numeric(14, 4) NOT NULL,
	"unit_price" numeric(18, 6),
	"line_total" numeric(18, 4),
	"grind_note" text,
	"allocated_weight_kg" numeric(14, 4) DEFAULT '0' NOT NULL,
	"fulfilled_weight_kg" numeric(14, 4) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"channel" "sales_channel_kind" DEFAULT 'direct' NOT NULL,
	"external_order_id" text,
	"status" "sales_order_status" DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"subtotal" numeric(18, 4) DEFAULT '0' NOT NULL,
	"total" numeric(18, 4) DEFAULT '0' NOT NULL,
	"ordered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_ship_at" date,
	"promised_at" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"machine_id" uuid,
	"profile_id" uuid,
	"blend_id" uuid,
	"position" integer NOT NULL,
	"planned_charge_kg" numeric(12, 4) NOT NULL,
	"planned_yield_kg" numeric(12, 4),
	"demand_line_ids" text[] DEFAULT '{}' NOT NULL,
	"roast_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine_bridge_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"machine_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roast_batch_goal_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"goal_id" uuid,
	"metric" "roast_goal_metric" NOT NULL,
	"actual_value" numeric(12, 4),
	"result" "goal_result" DEFAULT 'not_evaluated' NOT NULL,
	"deviation" numeric(12, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roast_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"batch_number" text NOT NULL,
	"machine_id" uuid,
	"profile_id" uuid,
	"location_id" uuid,
	"status" "roast_batch_status" DEFAULT 'scheduled' NOT NULL,
	"purpose" "roast_purpose" DEFAULT 'production' NOT NULL,
	"roaster_user_id" text,
	"charge_weight_kg" numeric(12, 4),
	"drop_weight_kg" numeric(12, 4),
	"weight_loss_pct" numeric(6, 3),
	"charge_temp_c" numeric(6, 2),
	"drop_temp_c" numeric(6, 2),
	"total_time_s" integer,
	"dry_end_s" integer,
	"first_crack_s" integer,
	"development_time_s" integer,
	"dtr_pct" numeric(5, 2),
	"max_ror_c_per_min" numeric(7, 3),
	"ambient_temp_c" numeric(6, 2),
	"ambient_humidity_pct" numeric(5, 2),
	"curve_preview" jsonb,
	"curve_object_key" text,
	"sample_count" integer,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roast_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"kind" "roast_event_kind" NOT NULL,
	"at_seconds" numeric(8, 2) NOT NULL,
	"bean_temp_c" numeric(6, 2),
	"ror_c_per_min" numeric(7, 3),
	"value" numeric(10, 4),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roast_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"metric" "roast_goal_metric" NOT NULL,
	"target_value" numeric(12, 4),
	"min_value" numeric(12, 4),
	"max_value" numeric(12, 4),
	"is_blocking" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roast_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"machine_id" uuid,
	"green_lot_id" uuid,
	"target_charge_kg" numeric(10, 4),
	"target_drop_temp_c" numeric(6, 2),
	"target_total_time_s" integer,
	"target_dtr_pct" numeric(5, 2),
	"reference_curve" jsonb,
	"reference_batch_id" uuid,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roast_samples" (
	"batch_id" uuid NOT NULL,
	"t" numeric(8, 2) NOT NULL,
	"bean_temp_c" numeric(6, 2),
	"env_temp_c" numeric(6, 2),
	"ror_c_per_min" numeric(7, 3),
	"gas_pct" numeric(5, 2),
	"airflow_pct" numeric(5, 2),
	"drum_rpm" numeric(6, 2)
);
--> statement-breakpoint
CREATE TABLE "cupping_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_sample_id" uuid NOT NULL,
	"cupper_user_id" text,
	"cupper_name" text,
	"total_score" numeric(5, 2),
	"fragrance" numeric(4, 2),
	"flavor" numeric(4, 2),
	"aftertaste" numeric(4, 2),
	"acidity" numeric(4, 2),
	"body" numeric(4, 2),
	"balance" numeric(4, 2),
	"uniformity" numeric(4, 2),
	"clean_cup" numeric(4, 2),
	"sweetness" numeric(4, 2),
	"overall" numeric(4, 2),
	"defects_penalty" numeric(5, 2) DEFAULT '0' NOT NULL,
	"descriptors" text[] DEFAULT '{}' NOT NULL,
	"responses" jsonb,
	"notes" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cupping_scores_sample_cupper_key" UNIQUE NULLS NOT DISTINCT("session_sample_id","cupper_user_id","cupper_name")
);
--> statement-breakpoint
CREATE TABLE "cupping_session_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"blind_code" text NOT NULL,
	"sample_id" uuid,
	"green_lot_id" uuid,
	"roasted_lot_id" uuid,
	"roast_batch_id" uuid,
	"avg_total_score" numeric(5, 2),
	"score_count" integer DEFAULT 0 NOT NULL,
	"score_std_dev" numeric(5, 3)
);
--> statement-breakpoint
CREATE TABLE "cupping_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"session_number" text NOT NULL,
	"name" text NOT NULL,
	"mode" "cupping_mode" DEFAULT 'blind' NOT NULL,
	"status" "cupping_session_status" DEFAULT 'draft' NOT NULL,
	"template_id" uuid,
	"template_version" integer,
	"location_id" uuid,
	"lead_user_id" text,
	"scheduled_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "form_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "form_template_kind" NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"schema" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "green_gradings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"green_lot_id" uuid,
	"sample_id" uuid,
	"template_id" uuid,
	"template_version" integer,
	"standard" "grading_standard" DEFAULT 'sca' NOT NULL,
	"grader_user_id" text,
	"moisture_pct" numeric(5, 2),
	"water_activity" numeric(4, 3),
	"screen_size_avg" numeric(5, 2),
	"density_g_per_l" numeric(7, 2),
	"color_score" numeric(6, 2),
	"defects_primary" integer DEFAULT 0 NOT NULL,
	"defects_secondary" integer DEFAULT 0 NOT NULL,
	"full_defect_equivalents" numeric(6, 2),
	"grade" text,
	"passed" boolean DEFAULT true NOT NULL,
	"screen_distribution" jsonb,
	"defect_counts" jsonb,
	"responses" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blend_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"blend_id" uuid NOT NULL,
	"green_lot_id" uuid,
	"roasted_lot_id" uuid,
	"target_ratio_pct" numeric(7, 4) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "blend_component_one_source" CHECK (num_nonnulls(green_lot_id, roasted_lot_id) = 1)
);
--> statement-breakpoint
CREATE TABLE "blends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"blend_type" "blend_type" NOT NULL,
	"target_weight_loss_pct" numeric(5, 2),
	"roast_level" text,
	"is_decaf" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roasted_lot_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"roasted_lot_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"event_type" "inventory_event" NOT NULL,
	"location_id" uuid,
	"weight_before_kg" numeric(14, 4) NOT NULL,
	"delta_kg" numeric(14, 4) NOT NULL,
	"weight_after_kg" numeric(14, 4) NOT NULL,
	"group_id" uuid,
	"order_line_id" uuid,
	"comment" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roasted_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"lot_code" text NOT NULL,
	"lot_kind" "roasted_lot_kind" DEFAULT 'loose' NOT NULL,
	"blend_id" uuid,
	"roast_batch_id" uuid,
	"roast_level" text,
	"agtron" numeric(6, 2),
	"initial_weight_kg" numeric(14, 4) NOT NULL,
	"current_weight_kg" numeric(14, 4) DEFAULT '0' NOT NULL,
	"reserved_weight_kg" numeric(14, 4) DEFAULT '0' NOT NULL,
	"location_id" uuid,
	"roasted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"best_before_at" timestamp with time zone,
	"unit_cost_base" numeric(18, 6),
	"status" "lot_status" DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"subject_id" text NOT NULL,
	"digest_date" date NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"payload" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"description" text NOT NULL,
	"producer_id" uuid,
	"weight_kg" numeric(14, 4) NOT NULL,
	"received_weight_kg" numeric(14, 4) DEFAULT '0' NOT NULL,
	"bag_count" integer,
	"bag_weight_kg" numeric(10, 4),
	"unit_price" numeric(18, 6),
	"differential" numeric(18, 6),
	"futures_month" text,
	"futures_price" numeric(18, 6),
	"fixed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"contract_line_id" uuid,
	"kind" "milestone_kind" NOT NULL,
	"status" "milestone_status" DEFAULT 'pending' NOT NULL,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"assignee_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_number" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"status" "contract_status" DEFAULT 'draft' NOT NULL,
	"contract_date" date,
	"incoterm" "incoterm",
	"currency" text DEFAULT 'USD' NOT NULL,
	"price_type" "contract_price_type" DEFAULT 'fixed' NOT NULL,
	"payment_terms_days" integer,
	"total_weight_kg" numeric(14, 4) DEFAULT '0' NOT NULL,
	"shipped_weight_kg" numeric(14, 4) DEFAULT '0' NOT NULL,
	"received_weight_kg" numeric(14, 4) DEFAULT '0' NOT NULL,
	"total_value" numeric(18, 4) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sample_number" text NOT NULL,
	"sample_type" "sample_type" NOT NULL,
	"status" "sample_status" DEFAULT 'requested' NOT NULL,
	"name" text NOT NULL,
	"partner_id" uuid,
	"producer_id" uuid,
	"contract_id" uuid,
	"contract_line_id" uuid,
	"green_lot_id" uuid,
	"po_number" text,
	"sales_number" text,
	"tracking_numbers" text[] DEFAULT '{}' NOT NULL,
	"weight_kg" numeric(10, 4),
	"requested_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decision_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" "shipment_status" DEFAULT 'booked' NOT NULL,
	"vessel" text,
	"carrier" text,
	"container_number" text,
	"port_of_loading" text,
	"port_of_discharge" text,
	"etd" date,
	"eta" date,
	"ata" date,
	"destination_location_id" uuid,
	"weight_kg" numeric(14, 4) NOT NULL,
	"received_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machines" ADD CONSTRAINT "machines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producers" ADD CONSTRAINT "producers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producers" ADD CONSTRAINT "producers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_green_lot_id_green_lots_id_fk" FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_components" ADD CONSTRAINT "cost_components_unit_id_units_of_measure_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units_of_measure"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_lots" ADD CONSTRAINT "green_lots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_lots" ADD CONSTRAINT "green_lots_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_lots" ADD CONSTRAINT "green_lots_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_lots" ADD CONSTRAINT "green_lots_entered_unit_id_units_of_measure_id_fk" FOREIGN KEY ("entered_unit_id") REFERENCES "public"."units_of_measure"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_lots" ADD CONSTRAINT "green_lots_cost_unit_id_units_of_measure_id_fk" FOREIGN KEY ("cost_unit_id") REFERENCES "public"."units_of_measure"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_lots" ADD CONSTRAINT "green_lots_default_location_id_locations_id_fk" FOREIGN KEY ("default_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliations" ADD CONSTRAINT "inventory_reconciliations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliations" ADD CONSTRAINT "inventory_reconciliations_green_lot_id_green_lots_id_fk" FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reconciliations" ADD CONSTRAINT "inventory_reconciliations_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_green_lot_id_green_lots_id_fk" FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landed_costs" ADD CONSTRAINT "landed_costs_green_lot_id_green_lots_id_fk" FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumption" ADD CONSTRAINT "lot_consumption_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumption" ADD CONSTRAINT "lot_consumption_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_location_balances" ADD CONSTRAINT "lot_location_balances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_location_balances" ADD CONSTRAINT "lot_location_balances_green_lot_id_green_lots_id_fk" FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_location_balances" ADD CONSTRAINT "lot_location_balances_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills_of_materials" ADD CONSTRAINT "bills_of_materials_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills_of_materials" ADD CONSTRAINT "bills_of_materials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_bom_id_bills_of_materials_id_fk" FOREIGN KEY ("bom_id") REFERENCES "public"."bills_of_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bom_lines" ADD CONSTRAINT "bom_lines_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_material_id_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_transactions" ADD CONSTRAINT "material_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_unit_id_units_of_measure_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units_of_measure"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "materials" ADD CONSTRAINT "materials_supplier_partner_id_partners_id_fk" FOREIGN KEY ("supplier_partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_refresh_id_oauth_refresh_tokens_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "public"."oauth_refresh_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_resources" ADD CONSTRAINT "oauth_client_resources_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_client_resources" ADD CONSTRAINT "oauth_client_resources_resource_id_oauth_resources_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."oauth_resources"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD CONSTRAINT "oauth_clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consents" ADD CONSTRAINT "oauth_consents_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_consents" ADD CONSTRAINT "oauth_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_client_id_oauth_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_reference_id_organizations_id_fk" FOREIGN KEY ("reference_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_entitlement_overrides" ADD CONSTRAINT "org_entitlement_overrides_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_entitlement_overrides" ADD CONSTRAINT "org_entitlement_overrides_set_by_users_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_role_slug_roles_slug_fk" FOREIGN KEY ("role_slug") REFERENCES "public"."roles"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_invitations" ADD CONSTRAINT "org_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_members" ADD CONSTRAINT "org_members_role_slug_roles_slug_fk" FOREIGN KEY ("role_slug") REFERENCES "public"."roles"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_plan_slug_plans_slug_fk" FOREIGN KEY ("plan_slug") REFERENCES "public"."plans"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_slug_plans_slug_fk" FOREIGN KEY ("plan_slug") REFERENCES "public"."plans"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_slug_roles_slug_fk" FOREIGN KEY ("role_slug") REFERENCES "public"."roles"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units_of_measure" ADD CONSTRAINT "units_of_measure_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_order_line_id_sales_order_lines_id_fk" FOREIGN KEY ("order_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_roasted_lot_id_roasted_lots_id_fk" FOREIGN KEY ("roasted_lot_id") REFERENCES "public"."roasted_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fulfillments" ADD CONSTRAINT "fulfillments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_schedules" ADD CONSTRAINT "production_schedules_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_schedules" ADD CONSTRAINT "production_schedules_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_schedules" ADD CONSTRAINT "production_schedules_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_blend_id_blends_id_fk" FOREIGN KEY ("blend_id") REFERENCES "public"."blends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_batches" ADD CONSTRAINT "scheduled_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_batches" ADD CONSTRAINT "scheduled_batches_schedule_id_production_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."production_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_batches" ADD CONSTRAINT "scheduled_batches_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_batches" ADD CONSTRAINT "scheduled_batches_profile_id_roast_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."roast_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_batches" ADD CONSTRAINT "scheduled_batches_blend_id_blends_id_fk" FOREIGN KEY ("blend_id") REFERENCES "public"."blends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_bridge_tokens" ADD CONSTRAINT "machine_bridge_tokens_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_bridge_tokens" ADD CONSTRAINT "machine_bridge_tokens_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine_bridge_tokens" ADD CONSTRAINT "machine_bridge_tokens_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batch_goal_results" ADD CONSTRAINT "roast_batch_goal_results_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batch_goal_results" ADD CONSTRAINT "roast_batch_goal_results_batch_id_roast_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."roast_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batch_goal_results" ADD CONSTRAINT "roast_batch_goal_results_goal_id_roast_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."roast_goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batches" ADD CONSTRAINT "roast_batches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batches" ADD CONSTRAINT "roast_batches_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batches" ADD CONSTRAINT "roast_batches_profile_id_roast_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."roast_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batches" ADD CONSTRAINT "roast_batches_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_batches" ADD CONSTRAINT "roast_batches_roaster_user_id_users_id_fk" FOREIGN KEY ("roaster_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_events" ADD CONSTRAINT "roast_events_batch_id_roast_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."roast_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_goals" ADD CONSTRAINT "roast_goals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_goals" ADD CONSTRAINT "roast_goals_profile_id_roast_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."roast_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_profiles" ADD CONSTRAINT "roast_profiles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_profiles" ADD CONSTRAINT "roast_profiles_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_profiles" ADD CONSTRAINT "roast_profiles_green_lot_id_green_lots_id_fk" FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roast_samples" ADD CONSTRAINT "roast_samples_batch_id_roast_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."roast_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_scores" ADD CONSTRAINT "cupping_scores_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_scores" ADD CONSTRAINT "cupping_scores_session_sample_id_cupping_session_samples_id_fk" FOREIGN KEY ("session_sample_id") REFERENCES "public"."cupping_session_samples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_scores" ADD CONSTRAINT "cupping_scores_cupper_user_id_users_id_fk" FOREIGN KEY ("cupper_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_session_samples" ADD CONSTRAINT "cupping_session_samples_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_session_samples" ADD CONSTRAINT "cupping_session_samples_session_id_cupping_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."cupping_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_session_samples" ADD CONSTRAINT "cupping_session_samples_sample_id_samples_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."samples"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_session_samples" ADD CONSTRAINT "cupping_session_samples_green_lot_id_green_lots_id_fk" FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_session_samples" ADD CONSTRAINT "cupping_session_samples_roasted_lot_id_roasted_lots_id_fk" FOREIGN KEY ("roasted_lot_id") REFERENCES "public"."roasted_lots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_session_samples" ADD CONSTRAINT "cupping_session_samples_roast_batch_id_roast_batches_id_fk" FOREIGN KEY ("roast_batch_id") REFERENCES "public"."roast_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_sessions" ADD CONSTRAINT "cupping_sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_sessions" ADD CONSTRAINT "cupping_sessions_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_sessions" ADD CONSTRAINT "cupping_sessions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cupping_sessions" ADD CONSTRAINT "cupping_sessions_lead_user_id_users_id_fk" FOREIGN KEY ("lead_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_gradings" ADD CONSTRAINT "green_gradings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_gradings" ADD CONSTRAINT "green_gradings_green_lot_id_green_lots_id_fk" FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_gradings" ADD CONSTRAINT "green_gradings_sample_id_samples_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."samples"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_gradings" ADD CONSTRAINT "green_gradings_template_id_form_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."form_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_gradings" ADD CONSTRAINT "green_gradings_grader_user_id_users_id_fk" FOREIGN KEY ("grader_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blend_components" ADD CONSTRAINT "blend_components_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blend_components" ADD CONSTRAINT "blend_components_blend_id_blends_id_fk" FOREIGN KEY ("blend_id") REFERENCES "public"."blends"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blend_components" ADD CONSTRAINT "blend_components_green_lot_id_green_lots_id_fk" FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blends" ADD CONSTRAINT "blends_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roasted_lot_transactions" ADD CONSTRAINT "roasted_lot_transactions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roasted_lot_transactions" ADD CONSTRAINT "roasted_lot_transactions_roasted_lot_id_roasted_lots_id_fk" FOREIGN KEY ("roasted_lot_id") REFERENCES "public"."roasted_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roasted_lot_transactions" ADD CONSTRAINT "roasted_lot_transactions_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roasted_lot_transactions" ADD CONSTRAINT "roasted_lot_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roasted_lots" ADD CONSTRAINT "roasted_lots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roasted_lots" ADD CONSTRAINT "roasted_lots_blend_id_blends_id_fk" FOREIGN KEY ("blend_id") REFERENCES "public"."blends"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roasted_lots" ADD CONSTRAINT "roasted_lots_roast_batch_id_roast_batches_id_fk" FOREIGN KEY ("roast_batch_id") REFERENCES "public"."roast_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roasted_lots" ADD CONSTRAINT "roasted_lots_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_notifications" ADD CONSTRAINT "alert_notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_lines" ADD CONSTRAINT "contract_lines_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_lines" ADD CONSTRAINT "contract_lines_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_lines" ADD CONSTRAINT "contract_lines_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_contract_line_id_contract_lines_id_fk" FOREIGN KEY ("contract_line_id") REFERENCES "public"."contract_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_milestones" ADD CONSTRAINT "contract_milestones_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_producer_id_producers_id_fk" FOREIGN KEY ("producer_id") REFERENCES "public"."producers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_contract_line_id_contract_lines_id_fk" FOREIGN KEY ("contract_line_id") REFERENCES "public"."contract_lines"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "samples" ADD CONSTRAINT "samples_green_lot_id_green_lots_id_fk" FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_destination_location_id_locations_id_fk" FOREIGN KEY ("destination_location_id") REFERENCES "public"."locations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkeys_credential_id_idx" ON "passkeys" USING btree ("credential_i_d");--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "machines_org_code_idx" ON "machines" USING btree ("org_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "machines_device_id_idx" ON "machines" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "machines_org_location_idx" ON "machines" USING btree ("org_id","location_id","is_active");--> statement-breakpoint
CREATE INDEX "machines_org_created_idx" ON "machines" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_org_code_idx" ON "partners" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "partners_org_active_idx" ON "partners" USING btree ("org_id","is_active");--> statement-breakpoint
CREATE INDEX "partners_org_created_idx" ON "partners" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "partners_name_trgm_idx" ON "partners" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "producers_org_code_idx" ON "producers" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "producers_org_country_idx" ON "producers" USING btree ("org_id","country","region");--> statement-breakpoint
CREATE INDEX "producers_org_partner_idx" ON "producers" USING btree ("org_id","partner_id");--> statement-breakpoint
CREATE INDEX "producers_org_created_idx" ON "producers" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "producers_name_trgm_idx" ON "producers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "products_org_sku_idx" ON "products" USING btree ("org_id","sku");--> statement-breakpoint
CREATE INDEX "products_org_active_idx" ON "products" USING btree ("org_id","is_active","format");--> statement-breakpoint
CREATE INDEX "products_org_barcode_idx" ON "products" USING btree ("org_id","barcode");--> statement-breakpoint
CREATE INDEX "products_org_created_idx" ON "products" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "cost_components_org_lot_idx" ON "cost_components" USING btree ("org_id","green_lot_id");--> statement-breakpoint
CREATE INDEX "cost_components_org_line_idx" ON "cost_components" USING btree ("org_id","contract_line_id");--> statement-breakpoint
CREATE INDEX "cost_components_org_kind_idx" ON "cost_components" USING btree ("org_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "green_lots_org_code_idx" ON "green_lots" USING btree ("org_id","lot_code");--> statement-breakpoint
CREATE INDEX "green_lots_org_status_weight_idx" ON "green_lots" USING btree ("org_id","status","current_weight_kg");--> statement-breakpoint
CREATE INDEX "green_lots_org_registered_idx" ON "green_lots" USING btree ("org_id","registered_at");--> statement-breakpoint
CREATE INDEX "green_lots_org_producer_idx" ON "green_lots" USING btree ("org_id","producer_id");--> statement-breakpoint
CREATE INDEX "green_lots_org_parent_idx" ON "green_lots" USING btree ("org_id","parent_lot_id");--> statement-breakpoint
CREATE INDEX "green_lots_org_created_idx" ON "green_lots" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "green_lots_name_trgm_idx" ON "green_lots" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "inventory_recon_org_lot_idx" ON "inventory_reconciliations" USING btree ("org_id","green_lot_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_recon_open_idx" ON "inventory_reconciliations" USING btree ("org_id","created_at") WHERE resolved_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_txn_lot_seq_idx" ON "inventory_transactions" USING btree ("green_lot_id","seq");--> statement-breakpoint
CREATE INDEX "inventory_txn_org_lot_time_idx" ON "inventory_transactions" USING btree ("org_id","green_lot_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inventory_txn_org_event_time_idx" ON "inventory_transactions" USING btree ("org_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "inventory_txn_org_location_idx" ON "inventory_transactions" USING btree ("org_id","location_id","occurred_at");--> statement-breakpoint
CREATE INDEX "inventory_txn_group_idx" ON "inventory_transactions" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "inventory_txn_roast_idx" ON "inventory_transactions" USING btree ("roast_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "landed_costs_org_lot_idx" ON "landed_costs" USING btree ("org_id","green_lot_id");--> statement-breakpoint
CREATE INDEX "lot_consumption_src_idx" ON "lot_consumption" USING btree ("org_id","source_kind","source_id");--> statement-breakpoint
CREATE INDEX "lot_consumption_tgt_idx" ON "lot_consumption" USING btree ("org_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "lot_consumption_txn_idx" ON "lot_consumption" USING btree ("transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lot_location_balances_lot_loc_idx" ON "lot_location_balances" USING btree ("green_lot_id","location_id");--> statement-breakpoint
CREATE INDEX "lot_location_balances_org_loc_idx" ON "lot_location_balances" USING btree ("org_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_org_product_version_idx" ON "bills_of_materials" USING btree ("org_id","product_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "bom_org_product_active_idx" ON "bills_of_materials" USING btree ("org_id","product_id") WHERE is_active;--> statement-breakpoint
CREATE UNIQUE INDEX "bom_lines_bom_position_idx" ON "bom_lines" USING btree ("bom_id","position");--> statement-breakpoint
CREATE INDEX "bom_lines_material_idx" ON "bom_lines" USING btree ("material_id");--> statement-breakpoint
CREATE UNIQUE INDEX "material_txn_material_seq_idx" ON "material_transactions" USING btree ("material_id","seq");--> statement-breakpoint
CREATE INDEX "material_txn_org_material_time_idx" ON "material_transactions" USING btree ("org_id","material_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "materials_org_sku_idx" ON "materials" USING btree ("org_id","sku");--> statement-breakpoint
CREATE INDEX "materials_org_kind_idx" ON "materials" USING btree ("org_id","kind","is_active");--> statement-breakpoint
CREATE INDEX "materials_org_supplier_idx" ON "materials" USING btree ("org_id","supplier_partner_id");--> statement-breakpoint
CREATE INDEX "materials_org_created_idx" ON "materials" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "materials_org_reorder_idx" ON "materials" USING btree ("org_id","on_hand_qty") WHERE reorder_point is not null;--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_client_id_idx" ON "oauth_access_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_session_id_idx" ON "oauth_access_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_user_id_idx" ON "oauth_access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_access_tokens_refresh_id_idx" ON "oauth_access_tokens" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX "oauth_client_resources_client_id_idx" ON "oauth_client_resources" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_client_resources_resource_id_idx" ON "oauth_client_resources" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "oauth_clients_user_id_idx" ON "oauth_clients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_consents_client_id_idx" ON "oauth_consents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_consents_user_id_idx" ON "oauth_consents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_client_id_idx" ON "oauth_refresh_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_session_id_idx" ON "oauth_refresh_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_user_id_idx" ON "oauth_refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_idx" ON "api_keys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "api_keys_reference_idx" ON "api_keys" USING btree ("reference_id");--> statement-breakpoint
CREATE INDEX "api_keys_config_idx" ON "api_keys" USING btree ("config_id");--> statement-breakpoint
CREATE INDEX "audit_events_org_created_idx" ON "audit_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_org_resource_idx" ON "audit_events" USING btree ("org_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "events_org_occurred_idx" ON "events" USING btree ("org_id","occurred_at");--> statement-breakpoint
CREATE INDEX "events_fanout_pending_idx" ON "events" USING btree ("occurred_at") WHERE fanned_out_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "locations_org_code_idx" ON "locations" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "locations_org_kind_idx" ON "locations" USING btree ("org_id","kind","is_active");--> statement-breakpoint
CREATE INDEX "locations_org_created_idx" ON "locations" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "org_invitations_token_hash_idx" ON "org_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "org_invitations_org_idx" ON "org_invitations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "org_invitations_email_idx" ON "org_invitations" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_user_idx" ON "org_members" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "org_members_user_idx" ON "org_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "permissions_module_idx" ON "permissions" USING btree ("module");--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx" ON "role_permissions" USING btree ("role_slug");--> statement-breakpoint
CREATE INDEX "roles_org_idx" ON "roles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_of_measure_org_code_idx" ON "units_of_measure" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "allocations_org_line_idx" ON "allocations" USING btree ("org_id","order_line_id");--> statement-breakpoint
CREATE INDEX "allocations_org_lot_idx" ON "allocations" USING btree ("org_id","roasted_lot_id");--> statement-breakpoint
CREATE INDEX "allocations_open_idx" ON "allocations" USING btree ("org_id","roasted_lot_id") WHERE released_at is null;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_org_code_idx" ON "customers" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "customers_org_type_active_idx" ON "customers" USING btree ("org_id","customer_type","is_active");--> statement-breakpoint
CREATE INDEX "customers_org_created_idx" ON "customers" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "customers_name_trgm_idx" ON "customers" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "fulfillments_org_number_idx" ON "fulfillments" USING btree ("org_id","fulfillment_number");--> statement-breakpoint
CREATE INDEX "fulfillments_org_status_idx" ON "fulfillments" USING btree ("org_id","status","shipped_at");--> statement-breakpoint
CREATE INDEX "fulfillments_org_order_idx" ON "fulfillments" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "production_schedules_org_date_idx" ON "production_schedules" USING btree ("org_id","scheduled_date","status");--> statement-breakpoint
CREATE INDEX "production_schedules_org_created_idx" ON "production_schedules" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_lines_order_position_idx" ON "sales_order_lines" USING btree ("order_id","position");--> statement-breakpoint
CREATE INDEX "sales_order_lines_org_order_idx" ON "sales_order_lines" USING btree ("org_id","order_id");--> statement-breakpoint
CREATE INDEX "sales_order_lines_org_blend_idx" ON "sales_order_lines" USING btree ("org_id","blend_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_org_number_idx" ON "sales_orders" USING btree ("org_id","order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_org_channel_external_idx" ON "sales_orders" USING btree ("org_id","channel","external_order_id") WHERE external_order_id is not null;--> statement-breakpoint
CREATE INDEX "sales_orders_org_status_ship_idx" ON "sales_orders" USING btree ("org_id","status","requested_ship_at");--> statement-breakpoint
CREATE INDEX "sales_orders_org_customer_idx" ON "sales_orders" USING btree ("org_id","customer_id","ordered_at");--> statement-breakpoint
CREATE INDEX "sales_orders_org_created_idx" ON "sales_orders" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_batches_schedule_machine_position_idx" ON "scheduled_batches" USING btree ("schedule_id","machine_id","position");--> statement-breakpoint
CREATE INDEX "scheduled_batches_org_schedule_idx" ON "scheduled_batches" USING btree ("org_id","schedule_id");--> statement-breakpoint
CREATE INDEX "scheduled_batches_batch_idx" ON "scheduled_batches" USING btree ("roast_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "machine_bridge_tokens_hash_idx" ON "machine_bridge_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "machine_bridge_tokens_org_machine_idx" ON "machine_bridge_tokens" USING btree ("org_id","machine_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roast_goal_results_batch_metric_idx" ON "roast_batch_goal_results" USING btree ("batch_id","metric");--> statement-breakpoint
CREATE INDEX "roast_goal_results_org_result_idx" ON "roast_batch_goal_results" USING btree ("org_id","result","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roast_batches_org_number_idx" ON "roast_batches" USING btree ("org_id","batch_number");--> statement-breakpoint
CREATE INDEX "roast_batches_org_started_idx" ON "roast_batches" USING btree ("org_id","started_at");--> statement-breakpoint
CREATE INDEX "roast_batches_org_machine_started_idx" ON "roast_batches" USING btree ("org_id","machine_id","started_at");--> statement-breakpoint
CREATE INDEX "roast_batches_org_profile_started_idx" ON "roast_batches" USING btree ("org_id","profile_id","started_at");--> statement-breakpoint
CREATE INDEX "roast_batches_org_status_idx" ON "roast_batches" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "roast_batches_org_created_idx" ON "roast_batches" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "roast_events_batch_time_idx" ON "roast_events" USING btree ("batch_id","at_seconds");--> statement-breakpoint
CREATE INDEX "roast_events_kind_idx" ON "roast_events" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "roast_goals_profile_metric_idx" ON "roast_goals" USING btree ("profile_id","metric");--> statement-breakpoint
CREATE UNIQUE INDEX "roast_profiles_org_code_version_idx" ON "roast_profiles" USING btree ("org_id","code","version");--> statement-breakpoint
CREATE INDEX "roast_profiles_org_machine_idx" ON "roast_profiles" USING btree ("org_id","machine_id","is_active");--> statement-breakpoint
CREATE INDEX "roast_profiles_org_created_idx" ON "roast_profiles" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "roast_samples_batch_t_idx" ON "roast_samples" USING btree ("batch_id","t");--> statement-breakpoint
CREATE INDEX "cupping_scores_org_cupper_idx" ON "cupping_scores" USING btree ("org_id","cupper_user_id","submitted_at");--> statement-breakpoint
CREATE INDEX "cupping_scores_org_total_idx" ON "cupping_scores" USING btree ("org_id","total_score");--> statement-breakpoint
CREATE UNIQUE INDEX "cupping_samples_session_position_idx" ON "cupping_session_samples" USING btree ("session_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "cupping_samples_session_code_idx" ON "cupping_session_samples" USING btree ("session_id","blind_code");--> statement-breakpoint
CREATE INDEX "cupping_samples_org_green_idx" ON "cupping_session_samples" USING btree ("org_id","green_lot_id");--> statement-breakpoint
CREATE INDEX "cupping_samples_org_sample_idx" ON "cupping_session_samples" USING btree ("org_id","sample_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cupping_sessions_org_number_idx" ON "cupping_sessions" USING btree ("org_id","session_number");--> statement-breakpoint
CREATE INDEX "cupping_sessions_org_status_idx" ON "cupping_sessions" USING btree ("org_id","status","scheduled_at");--> statement-breakpoint
CREATE INDEX "cupping_sessions_org_created_idx" ON "cupping_sessions" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_org_kind_name_version_idx" ON "form_templates" USING btree ("org_id","kind","name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "form_templates_org_kind_default_idx" ON "form_templates" USING btree ("org_id","kind") WHERE is_default;--> statement-breakpoint
CREATE INDEX "form_templates_org_kind_idx" ON "form_templates" USING btree ("org_id","kind","archived_at");--> statement-breakpoint
CREATE INDEX "green_gradings_org_lot_idx" ON "green_gradings" USING btree ("org_id","green_lot_id","created_at");--> statement-breakpoint
CREATE INDEX "green_gradings_org_sample_idx" ON "green_gradings" USING btree ("org_id","sample_id");--> statement-breakpoint
CREATE INDEX "green_gradings_org_passed_idx" ON "green_gradings" USING btree ("org_id","passed","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "blend_components_blend_position_idx" ON "blend_components" USING btree ("blend_id","position");--> statement-breakpoint
CREATE INDEX "blend_components_green_idx" ON "blend_components" USING btree ("green_lot_id");--> statement-breakpoint
CREATE INDEX "blend_components_roasted_idx" ON "blend_components" USING btree ("roasted_lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blends_org_code_idx" ON "blends" USING btree ("org_id","code");--> statement-breakpoint
CREATE INDEX "blends_org_type_active_idx" ON "blends" USING btree ("org_id","blend_type","is_active");--> statement-breakpoint
CREATE INDEX "blends_org_created_idx" ON "blends" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "roasted_txn_lot_seq_idx" ON "roasted_lot_transactions" USING btree ("roasted_lot_id","seq");--> statement-breakpoint
CREATE INDEX "roasted_txn_org_lot_time_idx" ON "roasted_lot_transactions" USING btree ("org_id","roasted_lot_id","occurred_at");--> statement-breakpoint
CREATE INDEX "roasted_txn_org_event_idx" ON "roasted_lot_transactions" USING btree ("org_id","event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roasted_lots_org_code_idx" ON "roasted_lots" USING btree ("org_id","lot_code");--> statement-breakpoint
CREATE INDEX "roasted_lots_org_status_roasted_idx" ON "roasted_lots" USING btree ("org_id","status","roasted_at");--> statement-breakpoint
CREATE INDEX "roasted_lots_org_best_before_idx" ON "roasted_lots" USING btree ("org_id","best_before_at");--> statement-breakpoint
CREATE INDEX "roasted_lots_org_blend_idx" ON "roasted_lots" USING btree ("org_id","blend_id");--> statement-breakpoint
CREATE INDEX "roasted_lots_org_batch_idx" ON "roasted_lots" USING btree ("org_id","roast_batch_id");--> statement-breakpoint
CREATE INDEX "roasted_lots_org_created_idx" ON "roasted_lots" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_notifications_dedupe_idx" ON "alert_notifications" USING btree ("org_id","rule_id","subject_id","digest_date");--> statement-breakpoint
CREATE INDEX "alert_notifications_org_date_idx" ON "alert_notifications" USING btree ("org_id","digest_date");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_lines_contract_position_idx" ON "contract_lines" USING btree ("contract_id","position");--> statement-breakpoint
CREATE INDEX "contract_lines_org_contract_idx" ON "contract_lines" USING btree ("org_id","contract_id");--> statement-breakpoint
CREATE INDEX "contract_lines_org_producer_idx" ON "contract_lines" USING btree ("org_id","producer_id");--> statement-breakpoint
CREATE INDEX "contract_milestones_org_due_idx" ON "contract_milestones" USING btree ("org_id","due_at","status");--> statement-breakpoint
CREATE INDEX "contract_milestones_org_contract_idx" ON "contract_milestones" USING btree ("org_id","contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_org_number_idx" ON "contracts" USING btree ("org_id","contract_number");--> statement-breakpoint
CREATE INDEX "contracts_org_status_date_idx" ON "contracts" USING btree ("org_id","status","contract_date");--> statement-breakpoint
CREATE INDEX "contracts_org_partner_idx" ON "contracts" USING btree ("org_id","partner_id");--> statement-breakpoint
CREATE INDEX "contracts_org_created_idx" ON "contracts" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "samples_org_number_idx" ON "samples" USING btree ("org_id","sample_number");--> statement-breakpoint
CREATE INDEX "samples_org_status_due_idx" ON "samples" USING btree ("org_id","status","due_at");--> statement-breakpoint
CREATE INDEX "samples_org_type_idx" ON "samples" USING btree ("org_id","sample_type");--> statement-breakpoint
CREATE INDEX "samples_org_partner_idx" ON "samples" USING btree ("org_id","partner_id");--> statement-breakpoint
CREATE INDEX "samples_org_contract_idx" ON "samples" USING btree ("org_id","contract_id");--> statement-breakpoint
CREATE INDEX "samples_org_created_idx" ON "samples" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "samples_tracking_idx" ON "samples" USING gin ("tracking_numbers");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_org_reference_idx" ON "shipments" USING btree ("org_id","reference");--> statement-breakpoint
CREATE INDEX "shipments_org_status_eta_idx" ON "shipments" USING btree ("org_id","status","eta");--> statement-breakpoint
CREATE INDEX "shipments_org_contract_idx" ON "shipments" USING btree ("org_id","contract_id");