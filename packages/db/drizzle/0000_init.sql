CREATE TYPE "public"."actor_type" AS ENUM('user', 'api_key', 'oauth_client', 'system');--> statement-breakpoint
CREATE TYPE "public"."location_kind" AS ENUM('roastery', 'warehouse', 'cafe', 'lab', 'transit', 'external');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'paused');--> statement-breakpoint
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"role_slug" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
CREATE TABLE "org_oauth_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"role_slug" text NOT NULL,
	"created_by" text,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
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
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_role_slug_roles_slug_fk" FOREIGN KEY ("role_slug") REFERENCES "public"."roles"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "org_oauth_clients" ADD CONSTRAINT "org_oauth_clients_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_oauth_clients" ADD CONSTRAINT "org_oauth_clients_role_slug_roles_slug_fk" FOREIGN KEY ("role_slug") REFERENCES "public"."roles"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_oauth_clients" ADD CONSTRAINT "org_oauth_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_subscriptions" ADD CONSTRAINT "org_subscriptions_plan_slug_plans_slug_fk" FOREIGN KEY ("plan_slug") REFERENCES "public"."plans"("slug") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_slug_plans_slug_fk" FOREIGN KEY ("plan_slug") REFERENCES "public"."plans"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_slug_roles_slug_fk" FOREIGN KEY ("role_slug") REFERENCES "public"."roles"("slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units_of_measure" ADD CONSTRAINT "units_of_measure_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_idx" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "passkeys_credential_id_idx" ON "passkeys" USING btree ("credential_i_d");--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "api_keys_created_by_idx" ON "api_keys" USING btree ("created_by");--> statement-breakpoint
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
CREATE UNIQUE INDEX "org_oauth_clients_client_id_idx" ON "org_oauth_clients" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "org_oauth_clients_org_idx" ON "org_oauth_clients" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_idx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "permissions_module_idx" ON "permissions" USING btree ("module");--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx" ON "role_permissions" USING btree ("role_slug");--> statement-breakpoint
CREATE INDEX "roles_org_idx" ON "roles" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "units_of_measure_org_code_idx" ON "units_of_measure" USING btree ("org_id","code");