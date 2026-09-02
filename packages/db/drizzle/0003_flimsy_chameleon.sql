CREATE TABLE "label_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"width_mm" numeric(8, 2) NOT NULL,
	"height_mm" numeric(8, 2) NOT NULL,
	"margin_mm" numeric(8, 2) NOT NULL,
	"qr_size_mm" numeric(8, 2) NOT NULL,
	"qr_position" text NOT NULL,
	"layout" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "label_templates" ADD CONSTRAINT "label_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "label_templates_org_name_version_idx" ON "label_templates" USING btree ("org_id","name","version");--> statement-breakpoint
CREATE UNIQUE INDEX "label_templates_org_default_idx" ON "label_templates" USING btree ("org_id") WHERE is_default;--> statement-breakpoint
CREATE INDEX "label_templates_org_created_idx" ON "label_templates" USING btree ("org_id","created_at","id");