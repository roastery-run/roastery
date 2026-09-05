CREATE TABLE "data_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"object_key" text,
	"size_bytes" numeric(18, 0),
	"manifest" jsonb,
	"error" text,
	"requested_by" text,
	"completed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_exports_org_idx" ON "data_exports" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "organizations_purge_idx" ON "organizations" USING btree ("purge_after") WHERE deleted_at is not null;