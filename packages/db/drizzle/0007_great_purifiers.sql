CREATE TABLE "green_lot_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"green_lot_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"delta_kg" numeric(14, 4) NOT NULL,
	"reserved_before_kg" numeric(14, 4) NOT NULL,
	"reserved_after_kg" numeric(14, 4) NOT NULL,
	"reason" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "green_lot_reservations" ADD CONSTRAINT "green_lot_reservations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_lot_reservations" ADD CONSTRAINT "green_lot_reservations_green_lot_id_green_lots_id_fk" FOREIGN KEY ("green_lot_id") REFERENCES "public"."green_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "green_lot_reservations" ADD CONSTRAINT "green_lot_reservations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "green_lot_reservations_lot_seq_idx" ON "green_lot_reservations" USING btree ("green_lot_id","seq");--> statement-breakpoint
CREATE INDEX "green_lot_reservations_org_lot_idx" ON "green_lot_reservations" USING btree ("org_id","green_lot_id","created_at");